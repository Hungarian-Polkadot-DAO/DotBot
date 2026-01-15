/**
 * OpenAPI Test Runner
 * 
 * Automatically generates and runs integration tests from openapi.yaml
 * No maintenance burden - just maintain the OpenAPI spec!
 */

import fs from 'fs';
import path from 'path';
import axios from 'axios';
import { OpenAPIV3 } from 'openapi-types';
import YAML from 'yaml';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';

interface TestResult {
  method: string;
  path: string;
  status: 'pass' | 'fail' | 'skip';
  error?: string;
  duration: number;
  requestBody?: any;
  responseStatus?: number;
  responseBody?: any;
  validationErrors?: string[];
}

class OpenAPITestRunner {
  private spec: OpenAPIV3.Document;
  private baseUrl: string;
  private results: TestResult[] = [];
  private cachedSessionId: string | null = null;
  private ajv: Ajv;
  private readonly REQUEST_TIMEOUT_MS = 120000; // 2 minutes - enough for RPC connection attempts

  constructor(specPath: string, baseUrl: string) {
    const specContent = fs.readFileSync(specPath, 'utf-8');
    this.spec = YAML.parse(specContent) as OpenAPIV3.Document;
    this.baseUrl = baseUrl;
    
    // Initialize AJV with OpenAPI 3.0 support
    this.ajv = new Ajv({
      strict: false,
      validateSchema: false,
      allErrors: true,
      verbose: true,
    });
    addFormats(this.ajv);
  }


  /**
   * Get a real chatId from the session's chats
   * Creates a chat if none exist
   */
  private async ensureChatId(sessionId: string): Promise<string> {
    try {
      // Get list of chats for this session
      const chatsPath = `/api/dotbot/session/${sessionId}/chats`;
      const response = await axios.get(`${this.baseUrl}${chatsPath}`, {
        validateStatus: () => true,
        timeout: this.REQUEST_TIMEOUT_MS,
      });

      if (response.status === 200 && response.data.chats && response.data.chats.length > 0) {
        // Use the first chat
        return response.data.chats[0].id;
      }

      // No chats exist, create one by sending a chat message
      // First, get session info to get wallet details
      const sessionPath = `/api/dotbot/session/${sessionId}`;
      const sessionResponse = await axios.get(`${this.baseUrl}${sessionPath}`, {
        validateStatus: () => true,
      });

      if (sessionResponse.status !== 200) {
        throw new Error(`Failed to get session info: ${sessionResponse.status}`);
      }

      const sessionData = sessionResponse.data;

      const chatPath = '/api/dotbot/chat';
      const chatOp = this.spec.paths?.[chatPath]?.post;
      
      if (!chatOp) {
        throw new Error('Cannot find POST /api/dotbot/chat endpoint to create a chat');
      }

      // Generate request body for chat
      const requestBodyContent = (chatOp.requestBody as OpenAPIV3.RequestBodyObject)?.content;
      const jsonContent = requestBodyContent?.['application/json'];
      if (!jsonContent?.schema) {
        throw new Error('Cannot find request body schema for chat creation');
      }

      const requestBody = this.generateTestData(jsonContent.schema as OpenAPIV3.SchemaObject | OpenAPIV3.ReferenceObject);
      
      // Add sessionId and wallet from session
      requestBody.sessionId = sessionId;
      if (sessionData.wallet) {
        requestBody.wallet = sessionData.wallet;
      }

      const chatResponse = await axios.post(`${this.baseUrl}${chatPath}`, requestBody, {
        headers: { 'Content-Type': 'application/json' },
        validateStatus: () => true,
        timeout: this.REQUEST_TIMEOUT_MS,
      });

      if (chatResponse.status !== 200) {
        throw new Error(`Failed to create chat: ${chatResponse.status} - ${JSON.stringify(chatResponse.data)}`);
      }

      // Try to get chatId from response or from the chats list
      if (chatResponse.data.chatId) {
        return chatResponse.data.chatId;
      }

      // Get chats again to find the newly created one
      const chatsResponse = await axios.get(`${this.baseUrl}${chatsPath}`, {
        validateStatus: () => true,
        timeout: this.REQUEST_TIMEOUT_MS,
      });

      if (chatsResponse.status === 200 && chatsResponse.data.chats && chatsResponse.data.chats.length > 0) {
        return chatsResponse.data.chats[0].id;
      }

      throw new Error('Failed to get chatId after creating chat');
    } catch (error: any) {
      throw new Error(`Failed to get/create chatId: ${error.message}`);
    }
  }

  /**
   * Get a real executionId from the current chat
   * Returns null if no execution exists (which is fine for some endpoints)
   */
  private async ensureExecutionId(sessionId: string, chatId: string): Promise<string | null> {
    try {
      // Load the chat to make it current
      const loadPath = `/api/dotbot/session/${sessionId}/chats/${chatId}/load`;
      await axios.post(`${this.baseUrl}${loadPath}`, {}, {
        validateStatus: () => true,
        timeout: this.REQUEST_TIMEOUT_MS,
      });

      // Get the chat instance to check for executions
      const getChatPath = `/api/dotbot/session/${sessionId}/chats/${chatId}`;
      const response = await axios.get(`${this.baseUrl}${getChatPath}`, {
        validateStatus: () => true,
      });

      if (response.status === 200 && response.data.chat) {
        const chat = response.data.chat;
        
        // Look for execution messages in the chat
        if (chat.messages && Array.isArray(chat.messages)) {
          for (const message of chat.messages) {
            if (message.type === 'execution' && message.executionId) {
              return message.executionId;
            }
          }
        }
      }

      // No execution found - return null (some endpoints handle this)
      return null;
    } catch (error: any) {
      // If we can't get executionId, return null
      return null;
    }
  }

  /**
   * Create a session if needed and return the sessionId
   * Also verifies the session exists and recreates it if it was deleted
   */
  private async ensureSession(): Promise<string> {
    // If we have a cached sessionId, verify it still exists
    if (this.cachedSessionId) {
      try {
        const getSessionPath = `/api/dotbot/session/${this.cachedSessionId}`;
        const response = await axios.get(`${this.baseUrl}${getSessionPath}`, {
          validateStatus: () => true,
          timeout: this.REQUEST_TIMEOUT_MS,
        });
        
        // If session exists, return it
        if (response.status === 200) {
          return this.cachedSessionId;
        }
        
        // Session was deleted, clear cache and recreate
        this.cachedSessionId = null;
      } catch (error) {
        // Error checking session, clear cache and recreate
        this.cachedSessionId = null;
      }
    }

    try {
      // Find the create session endpoint
      const createSessionPath = '/api/dotbot/session';
      const createSessionOp = this.spec.paths?.[createSessionPath]?.post;
      
      if (!createSessionOp) {
        throw new Error('Cannot find POST /api/dotbot/session endpoint in OpenAPI spec');
      }

      // Generate request body for session creation
      const requestBodyContent = (createSessionOp.requestBody as OpenAPIV3.RequestBodyObject)?.content;
      const jsonContent = requestBodyContent?.['application/json'];
      if (!jsonContent?.schema) {
        throw new Error('Cannot find request body schema for session creation');
      }

      const requestBody = this.generateTestData(jsonContent.schema as OpenAPIV3.SchemaObject | OpenAPIV3.ReferenceObject);

      // Create the session
      const response = await axios.post(`${this.baseUrl}${createSessionPath}`, requestBody, {
        headers: { 'Content-Type': 'application/json' },
        validateStatus: () => true,
        timeout: this.REQUEST_TIMEOUT_MS,
      });

      if (response.status !== 200) {
        throw new Error(`Failed to create session: ${response.status} - ${JSON.stringify(response.data)}`);
      }

      // Extract sessionId from response
      // The sessionId is typically in the response body or can be derived from the wallet
      const sessionData = response.data;
      let sessionId: string;
      
      if (sessionData.sessionId) {
        sessionId = sessionData.sessionId;
      } else if (sessionData.session?.id) {
        sessionId = sessionData.session.id;
      } else if (requestBody.wallet?.address) {
        // Session ID format: wallet:{address}:{environment}
        const environment = requestBody.wallet.environment || requestBody.environment || 'mainnet';
        sessionId = `wallet:${requestBody.wallet.address}:${environment}`;
      } else {
        throw new Error('Cannot determine sessionId from response');
      }

      this.cachedSessionId = sessionId;
      return sessionId;
    } catch (error: any) {
      throw new Error(`Failed to create session for testing: ${error.message}`);
    }
  }

  /**
   * Resolve $ref reference to actual schema
   */
  private resolveRef(ref: string): OpenAPIV3.SchemaObject | null {
    // Format: #/components/schemas/ChatRequest
    if (!ref.startsWith('#/')) {
      return null;
    }

    const parts = ref.slice(2).split('/'); // Remove '#/' and split
    let current: any = this.spec;

    for (const part of parts) {
      if (current && typeof current === 'object' && part in current) {
        current = current[part];
      } else {
        return null;
      }
    }

    return current as OpenAPIV3.SchemaObject;
  }

  /**
   * Fully resolve a schema, replacing all $ref references
   */
  private resolveSchema(schema: OpenAPIV3.SchemaObject | OpenAPIV3.ReferenceObject, visited: Set<string> = new Set()): any {
    // Handle $ref
    if ('$ref' in schema) {
      const ref = schema.$ref;
      
      // Prevent circular references
      if (visited.has(ref)) {
        return { $ref: ref }; // Return ref as-is to break cycle
      }
      visited.add(ref);
      
      const resolved = this.resolveRef(ref);
      if (resolved) {
        return this.resolveSchema(resolved, visited);
      }
      return schema;
    }

    const schemaObj = schema as OpenAPIV3.SchemaObject;
    const resolved: any = { ...schemaObj };

    // Resolve properties
    if (schemaObj.properties) {
      resolved.properties = {};
      for (const [key, prop] of Object.entries(schemaObj.properties)) {
        resolved.properties[key] = this.resolveSchema(prop, new Set(visited));
      }
    }

    // Resolve items (for arrays)
    if (schemaObj.type === 'array' && 'items' in schemaObj && schemaObj.items) {
      resolved.items = this.resolveSchema(schemaObj.items, new Set(visited));
    }

    // Resolve allOf, anyOf, oneOf
    if (schemaObj.allOf) {
      resolved.allOf = schemaObj.allOf.map(s => this.resolveSchema(s, new Set(visited)));
    }
    if (schemaObj.anyOf) {
      resolved.anyOf = schemaObj.anyOf.map(s => this.resolveSchema(s, new Set(visited)));
    }
    if (schemaObj.oneOf) {
      resolved.oneOf = schemaObj.oneOf.map(s => this.resolveSchema(s, new Set(visited)));
    }

    return resolved;
  }

  /**
   * Convert OpenAPI 3.0 schema to JSON Schema for AJV
   */
  private convertToJSONSchema(openApiSchema: any): any {
    const jsonSchema = { ...openApiSchema };
    
    // Remove OpenAPI-specific properties that AJV doesn't understand
    delete jsonSchema['x-'];
    
    // Handle nullable (OpenAPI 3.0) - convert to type array with null
    if (jsonSchema.nullable && jsonSchema.type) {
      if (Array.isArray(jsonSchema.type)) {
        if (!jsonSchema.type.includes('null')) {
          jsonSchema.type.push('null');
        }
      } else {
        jsonSchema.type = [jsonSchema.type, 'null'];
      }
      delete jsonSchema.nullable;
    }

    return jsonSchema;
  }

  /**
   * Generate test data for a request
   */
  private generateTestData(schema: OpenAPIV3.SchemaObject | OpenAPIV3.ReferenceObject): any {
    // Handle $ref
    if ('$ref' in schema) {
      const resolved = this.resolveRef(schema.$ref);
      if (resolved) {
        return this.generateTestData(resolved);
      }
      return {};
    }

    const schemaObj = schema as OpenAPIV3.SchemaObject;

    // Use example if available
    if (schemaObj.example !== undefined) {
      return schemaObj.example;
    }

    if (schemaObj.type === 'object' && schemaObj.properties) {
      const obj: any = {};
      
      // Include all required fields
      if (schemaObj.required) {
        for (const key of schemaObj.required) {
          if (schemaObj.properties[key]) {
            obj[key] = this.generateTestData(schemaObj.properties[key] as OpenAPIV3.SchemaObject | OpenAPIV3.ReferenceObject);
          }
        }
      }
      
      return obj;
    }

    if (schemaObj.type === 'string') {
      if (schemaObj.enum) return schemaObj.enum[0];
      if (schemaObj.format === 'date-time') return new Date().toISOString();
      if (schemaObj.example !== undefined) return schemaObj.example;
      return 'test-string';
    }

    if (schemaObj.type === 'number' || schemaObj.type === 'integer') {
      return schemaObj.example || 0;
    }

    if (schemaObj.type === 'boolean') {
      return true;
    }

    if (schemaObj.type === 'array' && schemaObj.items) {
      return [this.generateTestData(schemaObj.items as OpenAPIV3.SchemaObject | OpenAPIV3.ReferenceObject)];
    }

    return {};
  }

  /**
   * Validate data against OpenAPI schema using AJV
   */
  private validateAgainstSchema(
    data: any,
    schema: OpenAPIV3.SchemaObject | OpenAPIV3.ReferenceObject
  ): { valid: boolean; errors: string[] } {
    try {
      // Fully resolve the schema (including all $ref references)
      const resolvedSchema = this.resolveSchema(schema);
      
      // Convert OpenAPI schema to JSON Schema format for AJV
      const jsonSchema = this.convertToJSONSchema(resolvedSchema);
      
      // Compile and validate
      const validate = this.ajv.compile(jsonSchema);
      const valid = validate(data);
      
      if (!valid && validate.errors) {
        const errors = validate.errors.map(err => {
          const path = err.instancePath || err.schemaPath;
          const message = err.message || 'Validation error';
          return `${path}: ${message}${err.params ? ` (${JSON.stringify(err.params)})` : ''}`;
        });
        return { valid: false, errors };
      }
      
      return { valid: true, errors: [] };
    } catch (error: any) {
      // Fallback to basic validation if AJV fails
      return {
        valid: false,
        errors: [`Schema validation error: ${error.message}`],
      };
    }
  }

  /**
   * Validate request body against schema
   */
  private validateRequest(
    requestBody: any,
    schema: OpenAPIV3.SchemaObject | OpenAPIV3.ReferenceObject
  ): { valid: boolean; errors: string[] } {
    return this.validateAgainstSchema(requestBody, schema);
  }

  /**
   * Validate response against schema
   */
  private validateResponse(
    response: any,
    schema: OpenAPIV3.SchemaObject | OpenAPIV3.ReferenceObject
  ): { valid: boolean; errors: string[] } {
    return this.validateAgainstSchema(response, schema);
  }

  /**
   * Test a single endpoint
   */
  private async testEndpoint(
    method: string,
    path: string,
    operation: OpenAPIV3.OperationObject
  ): Promise<TestResult> {
    const startTime = Date.now();
    
    try {
      // Skip if no responses defined
      if (!operation.responses || Object.keys(operation.responses).length === 0) {
        return {
          method,
          path,
          status: 'skip',
          duration: 0,
        };
      }

      // Generate request body if needed
      let requestBody: any = undefined;
      if (operation.requestBody) {
        const requestBodyContent = (operation.requestBody as OpenAPIV3.RequestBodyObject).content;
        const jsonContent = requestBodyContent?.['application/json'];
        if (jsonContent?.schema) {
          requestBody = this.generateTestData(jsonContent.schema as OpenAPIV3.SchemaObject | OpenAPIV3.ReferenceObject);
          
          // Validate request body against schema
          const requestValidation = this.validateRequest(requestBody, jsonContent.schema);
          if (!requestValidation.valid) {
            return {
              method,
              path,
              status: 'fail',
              error: `Request body validation failed: ${requestValidation.errors.join('; ')}`,
              duration: Date.now() - startTime,
              requestBody,
              validationErrors: requestValidation.errors,
            };
          }
        }
      }

      // Replace path parameters with real values
      let testPath = path;
      const pathParams = path.match(/\{([^}]+)\}/g);
      let sessionId: string | null = null;
      let chatId: string | null = null;
      
      if (pathParams) {
        // First, ensure session exists if needed
        const needsSession = pathParams.some(p => p.includes('sessionId'));
        const needsChat = pathParams.some(p => p.includes('chatId'));
        const needsExecution = pathParams.some(p => p.includes('executionId'));
        
        if (needsSession) {
          sessionId = await this.ensureSession();
        }
        
        if (needsChat && sessionId) {
          chatId = await this.ensureChatId(sessionId);
        }
        
        // Now replace parameters
        for (const param of pathParams) {
          const paramName = param.slice(1, -1);
          if (paramName.includes('sessionId')) {
            testPath = testPath.replace(param, sessionId!);
          } else if (paramName.includes('chatId')) {
            if (chatId) {
              testPath = testPath.replace(param, chatId);
            } else {
              // Fallback if chatId couldn't be obtained
              testPath = testPath.replace(param, 'chat_test_12345');
            }
          } else if (paramName.includes('executionId')) {
            if (sessionId && chatId) {
              const executionId = await this.ensureExecutionId(sessionId, chatId);
              if (executionId) {
                testPath = testPath.replace(param, executionId);
              } else {
                // No execution exists, use placeholder (will likely fail, but that's expected)
                testPath = testPath.replace(param, 'exec_test_12345');
              }
            } else {
              testPath = testPath.replace(param, 'exec_test_12345');
            }
          } else {
            testPath = testPath.replace(param, 'test');
          }
        }
      }

      // Make request
      const url = `${this.baseUrl}${testPath}`;
      const config: any = {
        method: method.toLowerCase(),
        url,
        validateStatus: () => true, // Don't throw on any status
      };

      if (requestBody) {
        config.data = requestBody;
        config.headers = { 'Content-Type': 'application/json' };
      }

      const response = await axios(config);
      const duration = Date.now() - startTime;

      // Determine expected status code(s)
      // Priority: 200 > 201 > 204 > first defined response
      const expectedStatusCodes = Object.keys(operation.responses || {})
        .map(code => parseInt(code))
        .filter(code => !isNaN(code))
        .sort((a, b) => {
          // Prefer 200, then 201, then 204, then others
          if (a === 200) return -1;
          if (b === 200) return 1;
          if (a === 201) return -1;
          if (b === 201) return 1;
          if (a === 204) return -1;
          if (b === 204) return 1;
          return a - b;
        });
      
      const expectedStatus = expectedStatusCodes[0] || 200;
      const responseDef = operation.responses?.[String(response.status)] || operation.responses?.[String(expectedStatus)];
      
      // Check if status code is acceptable
      const isAcceptableStatus = expectedStatusCodes.includes(response.status) || 
                                  response.status >= 200 && response.status < 300;
      
      if (!isAcceptableStatus) {
        return {
          method,
          path,
          status: 'fail',
          error: `Expected one of [${expectedStatusCodes.join(', ')}], got ${response.status}`,
          duration,
          requestBody,
          responseStatus: response.status,
          responseBody: response.data,
        };
      }

      // Validate response schema if defined
      if (responseDef) {
        const responseContent = (responseDef as OpenAPIV3.ResponseObject).content;
        const jsonSchema = responseContent?.['application/json']?.schema;
        
        if (jsonSchema) {
          const validation = this.validateResponse(response.data, jsonSchema);
          if (!validation.valid) {
            return {
              method,
              path,
              status: 'fail',
              error: `Response schema validation failed: ${validation.errors.join('; ')}`,
              duration,
              requestBody,
              responseStatus: response.status,
              responseBody: response.data,
              validationErrors: validation.errors,
            };
          }
        }
      }

      return {
        method,
        path,
        status: 'pass',
        duration,
        requestBody,
        responseStatus: response.status,
        responseBody: response.data,
      };
    } catch (error: any) {
      return {
        method,
        path,
        status: 'fail',
        error: error.message || String(error),
        duration: Date.now() - startTime,
      };
    }
  }
  
  /**
   * Test a single endpoint with detailed output
   */
  async testSingleEndpoint(endpointPath: string, verbose: boolean = true): Promise<void> {
    console.log('======================================');
    console.log('Testing Single Endpoint');
    console.log('======================================');
    console.log(`Endpoint: ${endpointPath}`);
    console.log(`Base URL: ${this.baseUrl}`);
    console.log('');

    if (!this.spec.paths) {
      console.log('No paths found in OpenAPI spec');
      return;
    }

    // Find the endpoint
    let found = false;
    for (const [path, pathItem] of Object.entries(this.spec.paths)) {
      if (!pathItem) continue;

      // Check if this path matches (exact match or pattern match)
      if (path === endpointPath || path.replace(/\{[^}]+\}/g, '*') === endpointPath.replace(/\{[^}]+\}/g, '*')) {
        const methods = ['get', 'post', 'put', 'delete', 'patch'] as const;
        for (const method of methods) {
          const operation = pathItem[method];
          if (operation) {
            found = true;
            console.log(`\x1b[36mTesting: ${method.toUpperCase()} ${path}\x1b[0m`);
            console.log('');

            // Resolve path parameters for display
            let displayPath = path;
            const pathParams = path.match(/\{([^}]+)\}/g);
            let sessionId: string | null = null;
            let chatId: string | null = null;
            
            if (pathParams) {
              // First, ensure session exists if needed
              const needsSession = pathParams.some(p => p.includes('sessionId'));
              const needsChat = pathParams.some(p => p.includes('chatId'));
              const needsExecution = pathParams.some(p => p.includes('executionId'));
              
              try {
                if (needsSession) {
                  sessionId = await this.ensureSession();
                }
                
                if (needsChat && sessionId) {
                  chatId = await this.ensureChatId(sessionId);
                }
                
                // Now replace parameters
                for (const param of pathParams) {
                  const paramName = param.slice(1, -1);
                  if (paramName.includes('sessionId')) {
                    displayPath = displayPath.replace(param, sessionId || '{sessionId}');
                  } else if (paramName.includes('chatId')) {
                    displayPath = displayPath.replace(param, chatId || '{chatId}');
                  } else if (paramName.includes('executionId')) {
                    if (sessionId && chatId) {
                      const executionId = await this.ensureExecutionId(sessionId, chatId);
                      displayPath = displayPath.replace(param, executionId || '{executionId}');
                    } else {
                      displayPath = displayPath.replace(param, '{executionId}');
                    }
                  } else {
                    displayPath = displayPath.replace(param, 'test');
                  }
                }
              } catch (error) {
                // If anything fails, show placeholders
                for (const param of pathParams) {
                  const paramName = param.slice(1, -1);
                  if (paramName.includes('sessionId')) {
                    displayPath = displayPath.replace(param, '{sessionId}');
                  } else if (paramName.includes('chatId')) {
                    displayPath = displayPath.replace(param, '{chatId}');
                  } else if (paramName.includes('executionId')) {
                    displayPath = displayPath.replace(param, '{executionId}');
                  } else {
                    displayPath = displayPath.replace(param, 'test');
                  }
                }
              }
            }

            // Show request details
            if (verbose) {
              console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
              console.log('REQUEST');
              console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
              console.log(`Method: ${method.toUpperCase()}`);
              console.log(`URL: ${this.baseUrl}${displayPath}`);
              
              if (operation.requestBody) {
                const requestBodyContent = (operation.requestBody as OpenAPIV3.RequestBodyObject).content;
                const jsonContent = requestBodyContent?.['application/json'];
                if (jsonContent?.schema) {
                  const requestBody = this.generateTestData(jsonContent.schema as OpenAPIV3.SchemaObject | OpenAPIV3.ReferenceObject);
                  console.log('Body:');
                  console.log(JSON.stringify(requestBody, null, 2));
                }
              }
              console.log('');
            }

            const result = await this.testEndpoint(method.toUpperCase(), path, operation);
            
            // Show response details
            if (verbose) {
              console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
              console.log('RESPONSE');
              console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
              console.log(`Status: ${result.responseStatus || 'N/A'}`);
              if (result.responseBody) {
                console.log('Body:');
                console.log(JSON.stringify(result.responseBody, null, 2));
              }
              console.log('');
            }

            // Show validation results
            if (result.status === 'pass') {
              console.log('\x1b[32m✅ Test PASSED\x1b[0m');
              console.log(`Duration: ${result.duration}ms`);
            } else if (result.status === 'fail') {
              console.log('\x1b[31m❌ Test FAILED\x1b[0m');
              console.log(`Duration: ${result.duration}ms`);
              console.log('');
              console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
              console.log('ERROR DETAILS');
              console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
              console.log(`Error: ${result.error}`);
              
              if (result.validationErrors && result.validationErrors.length > 0) {
                console.log('');
                console.log('Validation Errors:');
                result.validationErrors.forEach((err, i) => {
                  console.log(`  ${i + 1}. ${err}`);
                });
              }

              // Show expected vs received
              if (result.responseStatus && result.responseStatus !== 200) {
                console.log('');
                console.log('Expected: HTTP 200');
                console.log(`Received: HTTP ${result.responseStatus}`);
              }

              // Show schema expectations
              const successResponse = operation.responses?.['200'];
              if (successResponse) {
                const responseContent = (successResponse as OpenAPIV3.ResponseObject).content;
                const jsonSchema = responseContent?.['application/json']?.schema;
                if (jsonSchema && !('$ref' in jsonSchema)) {
                  const schema = jsonSchema as OpenAPIV3.SchemaObject;
                  console.log('');
                  console.log('Expected Schema:');
                  if (schema.type) console.log(`  Type: ${schema.type}`);
                  if (schema.required) {
                    console.log(`  Required fields: ${schema.required.join(', ')}`);
                  }
                  if (schema.properties) {
                    console.log('  Properties:');
                    for (const [key, prop] of Object.entries(schema.properties)) {
                      const propSchema = prop as OpenAPIV3.SchemaObject;
                      const required = schema.required?.includes(key) ? ' (required)' : '';
                      console.log(`    - ${key}: ${propSchema.type || 'any'}${required}`);
                    }
                  }
                }
              }
            }
            console.log('');
            return;
          }
        }
      }
    }

    if (!found) {
      console.log(`\x1b[31m❌ Endpoint not found: ${endpointPath}\x1b[0m`);
      console.log('');
      console.log('Available endpoints:');
      for (const [path, pathItem] of Object.entries(this.spec.paths)) {
        if (!pathItem) continue;
        const methods = ['get', 'post', 'put', 'delete', 'patch'] as const;
        for (const method of methods) {
          if (pathItem[method]) {
            console.log(`  ${method.toUpperCase()} ${path}`);
          }
        }
      }
      process.exit(1);
    }
  }

  /**
   * Run all tests
   */
  async runTests(): Promise<void> {
    console.log('======================================');
    console.log('OpenAPI Integration Tests');
    console.log('======================================');
    console.log(`Base URL: ${this.baseUrl}`);
    console.log('');

    if (!this.spec.paths) {
      console.log('No paths found in OpenAPI spec');
      return;
    }

    // Test each endpoint
    for (const [path, pathItem] of Object.entries(this.spec.paths)) {
      if (!pathItem) continue;

      const methods = ['get', 'post', 'put', 'delete', 'patch'] as const;
      for (const method of methods) {
        const operation = pathItem[method];
        if (operation) {
          const result = await this.testEndpoint(method.toUpperCase(), path, operation);
          this.results.push(result);

          // Print result
          const statusIcon = result.status === 'pass' ? '✓' : result.status === 'fail' ? '✗' : '⊘';
          const statusColor = result.status === 'pass' ? '\x1b[32m' : result.status === 'fail' ? '\x1b[31m' : '\x1b[33m';
          console.log(
            `${statusColor}${statusIcon}\x1b[0m ${result.method} ${result.path} (${result.duration}ms)`
          );
          if (result.error) {
            console.log(`  Error: ${result.error}`);
          }
        }
      }
    }

    // Print summary
    console.log('');
    console.log('======================================');
    console.log('Summary');
    console.log('======================================');
    const passed = this.results.filter(r => r.status === 'pass').length;
    const failed = this.results.filter(r => r.status === 'fail').length;
    const skipped = this.results.filter(r => r.status === 'skip').length;
    console.log(`Passed: ${passed}`);
    console.log(`Failed: ${failed}`);
    console.log(`Skipped: ${skipped}`);
    console.log(`Total: ${this.results.length}`);
    console.log('');

    // Exit with error code if any tests failed (standard behavior for CI/CD)
    if (failed > 0) {
      console.log('\x1b[31m❌ Some tests failed. Fix the failing endpoints and run again.\x1b[0m');
      console.log('');
      process.exit(1);
    } else {
      console.log('\x1b[32m✅ All tests passed!\x1b[0m');
      console.log('');
    }
  }
}

// Run tests if executed directly
if (require.main === module) {
  const specPath = path.resolve(__dirname, '../../openapi.yaml');
  const baseUrl = process.env.TEST_BASE_URL || 'http://localhost:8000';

  // Parse command-line arguments
  const args = process.argv.slice(2);
  const endpointArg = args.find(arg => arg.startsWith('/'));
  const verbose = !args.includes('--quiet') && !args.includes('-q');

  const runner = new OpenAPITestRunner(specPath, baseUrl);

  if (endpointArg) {
    // Test single endpoint
    runner.testSingleEndpoint(endpointArg, verbose).catch((error) => {
      console.error('Test runner error:', error);
      process.exit(1);
    });
  } else {
    // Run all tests
    runner.runTests().catch((error) => {
      console.error('Test runner error:', error);
      process.exit(1);
    });
  }
}

export default OpenAPITestRunner;
