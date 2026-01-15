/**
 * Environment Configuration Validator
 * 
 * Validates environment variables at startup to catch configuration errors early.
 */

import { normalizeLogLevel, VALID_LOG_LEVELS } from './logLevel';

/**
 * Validation error with severity level
 */
export interface ValidationError {
  variable: string;
  value: string | undefined;
  message: string;
  severity: 'error' | 'warning';
}

/**
 * Validation result containing errors and warnings
 */
export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationError[];
}

/**
 * Validate log level configuration
 */
function validateLogLevel(): ValidationError | null {
  const logLevel = process.env.LOG_LEVEL || process.env.DOTBOT_LOG_LEVEL;
  
  if (!logLevel) {
    return null; // Optional, will use default
  }
  
  const normalized = normalizeLogLevel(logLevel);
  if (!normalized) {
    return {
      variable: 'LOG_LEVEL',
      value: logLevel,
      message: `Invalid log level. Valid values: ${VALID_LOG_LEVELS.join(', ')}`,
      severity: 'error',
    };
  }
  
  // Check if using deprecated uppercase format
  if (logLevel !== normalized) {
    return {
      variable: 'LOG_LEVEL',
      value: logLevel,
      message: `Deprecated log level format. Use lowercase: "${normalized}"`,
      severity: 'warning',
    };
  }
  
  return null;
}

/**
 * Check if URL has trailing /api suffix
 */
function hasApiSuffix(url: string): boolean {
  return url.endsWith('/api');
}

/**
 * Check if URL has trailing slash (excluding protocol)
 */
function hasTrailingSlash(url: string): boolean {
  return url.endsWith('/') && !url.endsWith('://');
}

/**
 * Validate URL format
 */
function isValidUrl(url: string): boolean {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}

/**
 * Validate a single URL variable
 */
function validateUrlVariable(varName: string, url: string | undefined): ValidationError[] {
  const errors: ValidationError[] = [];
  
  if (!url) {
    return errors; // Optional variable
  }
  
  // Check for trailing /api
  if (hasApiSuffix(url)) {
    errors.push({
      variable: varName,
      value: url,
      message: `URL should not include /api suffix. Use: ${url.replace(/\/api$/, '')}`,
      severity: 'error',
    });
  }
  
  // Check for trailing slash
  if (hasTrailingSlash(url)) {
    errors.push({
      variable: varName,
      value: url,
      message: 'URL should not end with trailing slash',
      severity: 'warning',
    });
  }
  
  // Basic URL format validation
  if (!isValidUrl(url)) {
    errors.push({
      variable: varName,
      value: url,
      message: 'Invalid URL format',
      severity: 'error',
    });
  }
  
  return errors;
}

/**
 * Validate URL configuration
 */
function validateUrls(): ValidationError[] {
  const urlVars = [
    'REACT_APP_API_URL',
    'BACKEND_URL',
    'FRONTEND_URL',
  ];
  
  const errors: ValidationError[] = [];
  
  for (const varName of urlVars) {
    const url = process.env[varName];
    const urlErrors = validateUrlVariable(varName, url);
    errors.push(...urlErrors);
  }
  
  return errors;
}

/**
 * Validate WebSocket URL
 */
function validateWebSocketUrl(): ValidationError[] {
  const wsUrl = process.env.WS_URL;
  if (!wsUrl) {
    return []; // Optional
  }
  
  const errors: ValidationError[] = [];
  
  // Check for trailing slash
  if (hasTrailingSlash(wsUrl)) {
    errors.push({
      variable: 'WS_URL',
      value: wsUrl,
      message: 'WebSocket URL should not end with trailing slash',
      severity: 'warning',
    });
  }
  
  // Validate WebSocket URL format
  if (!isValidUrl(wsUrl)) {
    errors.push({
      variable: 'WS_URL',
      value: wsUrl,
      message: 'Invalid WebSocket URL format',
      severity: 'error',
    });
  }
  
  // Check protocol
  if (!wsUrl.startsWith('ws://') && !wsUrl.startsWith('wss://')) {
    errors.push({
      variable: 'WS_URL',
      value: wsUrl,
      message: 'WebSocket URL must start with ws:// or wss://',
      severity: 'error',
    });
  }
  
  return errors;
}

/**
 * Validate all environment configuration
 */
export function validateEnvironment(): ValidationResult {
  const errors: ValidationError[] = [];
  const warnings: ValidationError[] = [];
  
  // Validate log level
  const logLevelError = validateLogLevel();
  if (logLevelError) {
    if (logLevelError.severity === 'error') {
      errors.push(logLevelError);
    } else {
      warnings.push(logLevelError);
    }
  }
  
  // Validate URLs
  const urlErrors = validateUrls();
  for (const error of urlErrors) {
    if (error.severity === 'error') {
      errors.push(error);
    } else {
      warnings.push(error);
    }
  }
  
  // Validate WebSocket URL
  const wsErrors = validateWebSocketUrl();
  for (const error of wsErrors) {
    if (error.severity === 'error') {
      errors.push(error);
    } else {
      warnings.push(error);
    }
  }
  
  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Log validation warnings
 */
function logWarnings(warnings: ValidationError[]): void {
  for (const warning of warnings) {
    console.warn(
      `[Config Warning] ${warning.variable}="${warning.value}": ${warning.message}`
    );
  }
}

/**
 * Log validation errors
 */
function logErrors(errors: ValidationError[]): void {
  for (const error of errors) {
    console.error(
      `[Config Error] ${error.variable}="${error.value}": ${error.message}`
    );
  }
}

/**
 * Validate environment and log results
 * Throws error if validation fails in production
 */
export function validateAndReport(): void {
  const result = validateEnvironment();
  
  // Log warnings
  if (result.warnings.length > 0) {
    logWarnings(result.warnings);
  }
  
  // Log errors
  if (result.errors.length > 0) {
    logErrors(result.errors);
  }
  
  // In production, fail fast on configuration errors
  if (!result.valid && process.env.NODE_ENV === 'production') {
    throw new Error(
      `Invalid environment configuration. Found ${result.errors.length} error(s). ` +
      `Please check your environment variables.`
    );
  }
}
