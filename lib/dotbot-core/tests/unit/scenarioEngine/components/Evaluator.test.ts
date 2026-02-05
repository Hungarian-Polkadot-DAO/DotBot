/**
 * Unit tests for Evaluator
 * 
 * Tests Evaluator with all evaluation logic and event emission.
 */

import { Evaluator, createEvaluator } from '../../../../scenarioEngine/components/Evaluator';
import type {
  Scenario,
  StepResult,
  ScenarioEngineEvent,
} from '../../../../scenarioEngine/types';

describe('Evaluator', () => {
  let evaluator: Evaluator;
  let mockEventListeners: jest.Mock[];

  beforeEach(() => {
    jest.clearAllMocks();
    evaluator = new Evaluator();
    mockEventListeners = [jest.fn(), jest.fn()];
    mockEventListeners.forEach(listener => evaluator.addEventListener(listener));
  });

  describe('Initialization', () => {
    it('should create evaluator with default and custom config', () => {
      expect(new Evaluator()).toBeInstanceOf(Evaluator);
      expect(new Evaluator({ strictMode: true })).toBeInstanceOf(Evaluator);
      expect(createEvaluator()).toBeInstanceOf(Evaluator);
      expect(createEvaluator({ strictMode: true })).toBeInstanceOf(Evaluator);
    });
  });

  describe('Event Listeners', () => {
    it('should add, remove, and handle listener errors', () => {
      const listener = jest.fn();
      const errorListener = jest.fn(() => { throw new Error('Listener error'); });
      
      evaluator.addEventListener(listener);
      evaluator.addEventListener(errorListener);
      evaluator.removeEventListener(listener);

      const scenario: Scenario = {
        id: 'test-1',
        name: 'Test',
        description: 'Test',
        category: 'happy-path',
        steps: [],
        expectations: [],
      };

      expect(() => evaluator.evaluate(scenario, [])).not.toThrow();
      expect(listener).not.toHaveBeenCalled();
      expect(errorListener).toHaveBeenCalled();
    });
  });

  describe('Evaluation', () => {
    it('should evaluate scenarios with no expectations', () => {
      const scenario: Scenario = {
        id: 'test-1',
        name: 'Test',
        description: 'Test',
        category: 'happy-path',
        steps: [],
        expectations: [],
      };

      const result = evaluator.evaluate(scenario, []);

      expect(result.passed).toBe(true);
      expect(result.score).toBe(100);
      expect(mockEventListeners[0]).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'log',
          level: 'info',
          message: expect.stringContaining('Starting evaluation'),
        })
      );
    });

    it('should evaluate response types correctly', () => {
      const testCases = [
        { responseType: 'execution', content: 'ExecutionArray with transaction', expected: true },
        { responseType: 'execution', content: 'Just text', expected: false },
        { responseType: 'error', content: 'I cannot do that', expected: true },
        { responseType: 'clarification', content: 'Could you specify?', expected: true },
      ];

      testCases.forEach(({ responseType, content, expected }) => {
        const scenario: Scenario = {
          id: 'test-1',
          name: 'Test',
          description: 'Test',
          category: 'happy-path',
          steps: [],
          expectations: [{ responseType: responseType as any }],
        };

        const stepResults: StepResult[] = [{
          stepId: 'step-1',
          success: true,
          startTime: 0,
          endTime: 100,
          duration: 100,
          response: { type: 'text', content },
        }];

        const result = evaluator.evaluate(scenario, stepResults);
        expect(result.expectations[0].met).toBe(expected);
      });
    });

    it('should evaluate content matching (shouldContain, shouldNotContain)', () => {
      const scenario: Scenario = {
        id: 'test-1',
        name: 'Test',
        description: 'Test',
        category: 'happy-path',
        steps: [],
        expectations: [
          { shouldContain: ['transfer', 'Alice'] },
          { shouldNotContain: ['error'] },
        ],
      };

      const stepResults: StepResult[] = [{
        stepId: 'step-1',
        success: true,
        startTime: 0,
        endTime: 100,
        duration: 100,
        response: { type: 'text', content: 'I will transfer 5 DOT to Alice' },
      }];

      const result = evaluator.evaluate(scenario, stepResults);
      expect(result.expectations[0].met).toBe(true);
      expect(result.expectations[1].met).toBe(true);
    });

    it('should evaluate topic mentions with synonyms', () => {
      const scenario: Scenario = {
        id: 'test-1',
        name: 'Test',
        description: 'Test',
        category: 'happy-path',
        steps: [],
        expectations: [{ shouldMention: ['asset hub'] }],
      };

      const stepResults: StepResult[] = [{
        stepId: 'step-1',
        success: true,
        startTime: 0,
        endTime: 100,
        duration: 100,
        response: { type: 'text', content: 'Transferring on Statemint' },
      }];

      const result = evaluator.evaluate(scenario, stepResults);
      expect(result.expectations[0].met).toBe(true);
    });

    it('should evaluate clarification requests and warnings', () => {
      const scenario: Scenario = {
        id: 'test-1',
        name: 'Test',
        description: 'Test',
        category: 'happy-path',
        steps: [],
        expectations: [
          { shouldAskFor: ['amount'] },
          { shouldWarn: ['reaping'] },
        ],
      };

      const stepResults: StepResult[] = [{
        stepId: 'step-1',
        success: true,
        startTime: 0,
        endTime: 100,
        duration: 100,
        response: {
          type: 'text',
          content: 'What amount? Warning: account reaping risk',
        },
      }];

      const result = evaluator.evaluate(scenario, stepResults);
      expect(result.expectations[0].met).toBe(true);
      expect(result.expectations[1].met).toBe(true);
    });

    it('should evaluate rejection detection', () => {
      const testCases = [
        { shouldReject: true, content: 'I cannot do that', expected: true },
        { shouldReject: true, content: 'I will do that', expected: false },
        { shouldReject: false, content: 'I will do that', expected: true },
      ];

      testCases.forEach(({ shouldReject, content, expected }) => {
        const scenario: Scenario = {
          id: 'test-1',
          name: 'Test',
          description: 'Test',
          category: 'adversarial',
          steps: [],
          expectations: [{ shouldReject }],
        };

        const stepResults: StepResult[] = [{
          stepId: 'step-1',
          success: true,
          startTime: 0,
          endTime: 100,
          duration: 100,
          response: { type: 'text', content },
        }];

        const result = evaluator.evaluate(scenario, stepResults);
        expect(result.expectations[0].met).toBe(expected);
      });
    });

    it('should evaluate custom validators', () => {
      const scenario: Scenario = {
        id: 'test-1',
        name: 'Test',
        description: 'Test',
        category: 'happy-path',
        steps: [],
        expectations: [
          { customValidator: 'return response.includes("DOT") && response.includes("transfer");' },
          { customValidator: 'return response.includes("USDC");' },
          { customValidator: 'throw new Error("Validator error");' },
        ],
      };

      const stepResults: StepResult[] = [{
        stepId: 'step-1',
        success: true,
        startTime: 0,
        endTime: 100,
        duration: 100,
        response: { type: 'text', content: 'I will transfer 5 DOT' },
      }];

      const result = evaluator.evaluate(scenario, stepResults);
      expect(result.expectations[0].met).toBe(true);
      expect(result.expectations[1].met).toBe(false);
      expect(result.expectations[2].met).toBe(false);
    });
  });

  describe('Scoring', () => {
    it('should calculate scores correctly', () => {
      const scenario: Scenario = {
        id: 'test-1',
        name: 'Test',
        description: 'Test',
        category: 'happy-path',
        steps: [],
        expectations: [
          { shouldContain: ['transfer'] },
          { shouldContain: ['Alice'] },
          { shouldContain: ['Bob'] },
        ],
      };

      const stepResults: StepResult[] = [{
        stepId: 'step-1',
        success: true,
        startTime: 0,
        endTime: 100,
        duration: 100,
        response: { type: 'text', content: 'I will transfer 5 DOT to Alice' },
      }];

      const result = evaluator.evaluate(scenario, stepResults);
      expect(result.score).toBeLessThan(100);
      expect(result.score).toBeGreaterThan(0);
      expect(result.passed).toBe(false); // 2/3 = 66.67% < 70%
    });

    it('should enforce strict mode', () => {
      const strictEvaluator = new Evaluator({ strictMode: true });
      const scenario: Scenario = {
        id: 'test-1',
        name: 'Test',
        description: 'Test',
        category: 'happy-path',
        steps: [],
        expectations: [
          { shouldContain: ['transfer'] },
          { shouldContain: ['Bob'] },
        ],
      };

      const stepResults: StepResult[] = [{
        stepId: 'step-1',
        success: true,
        startTime: 0,
        endTime: 100,
        duration: 100,
        response: { type: 'text', content: 'I will transfer 5 DOT to Alice' },
      }];

      const result = strictEvaluator.evaluate(scenario, stepResults);
      expect(result.passed).toBe(false);
    });
  });

  describe('Quick Check', () => {
    it('should return pass/fail correctly', () => {
      const scenario: Scenario = {
        id: 'test-1',
        name: 'Test',
        description: 'Test',
        category: 'happy-path',
        steps: [],
        expectations: [
          { shouldContain: ['transfer'] },
          { shouldContain: ['Bob'] },
        ],
      };

      const stepResults: StepResult[] = [{
        stepId: 'step-1',
        success: true,
        startTime: 0,
        endTime: 100,
        duration: 100,
        response: { type: 'text', content: 'I will transfer 5 DOT to Alice' },
      }];

      expect(evaluator.quickCheck(scenario, stepResults)).toBe(false);
    });
  });

  describe('Report Generation', () => {
    it('should generate detailed report with performance metrics', () => {
      const scenario: Scenario = {
        id: 'test-1',
        name: 'Test Scenario',
        description: 'Test',
        category: 'happy-path',
        steps: [],
        expectations: [{ shouldContain: ['transfer'] }],
      };

      const stepResults: StepResult[] = [
        { stepId: 'step-1', success: true, startTime: 0, endTime: 100, duration: 100 },
        { stepId: 'step-2', success: true, startTime: 100, endTime: 300, duration: 200 },
      ];

      const report = evaluator.generateReport(scenario, stepResults);

      expect(report.result).toBeDefined();
      expect(report.performance.totalDuration).toBe(300);
      expect(report.performance.avgStepDuration).toBe(150);
      expect(report.performance.slowestStep).toEqual({ id: 'step-2', duration: 200 });
      expect(report.performance.fastestStep).toEqual({ id: 'step-1', duration: 100 });
      expect(report.expectationResults).toBeDefined();
      expect(report.rawData.scenario).toEqual(scenario);
      expect(report.rawData.stepResults).toEqual(stepResults);
    });

    it('should handle empty step results', () => {
      const scenario: Scenario = {
        id: 'test-1',
        name: 'Test',
        description: 'Test',
        category: 'happy-path',
        steps: [],
        expectations: [],
      };

      const report = evaluator.generateReport(scenario, []);
      expect(report.performance.totalDuration).toBe(0);
      expect(report.performance.slowestStep).toBeNull();
    });
  });

  describe('Recommendations', () => {
    it('should generate recommendations for failed expectations', () => {
      const scenario: Scenario = {
        id: 'test-1',
        name: 'Test',
        description: 'Test',
        category: 'happy-path',
        steps: [],
        expectations: [{ shouldContain: ['transfer', 'Bob'] }],
      };

      const stepResults: StepResult[] = [{
        stepId: 'step-1',
        success: true,
        startTime: 0,
        endTime: 100,
        duration: 100,
        response: { type: 'text', content: 'I will transfer 5 DOT to Alice' },
      }];

      const result = evaluator.evaluate(scenario, stepResults);
      expect(result.recommendations).toBeDefined();
      expect(result.recommendations!.length).toBeGreaterThan(0);
    });

    it('should generate security recommendations for adversarial scenarios', () => {
      const scenario: Scenario = {
        id: 'test-1',
        name: 'Test',
        description: 'Test',
        category: 'adversarial',
        steps: [],
        expectations: [{ shouldReject: true }],
      };

      const stepResults: StepResult[] = [{
        stepId: 'step-1',
        success: true,
        startTime: 0,
        endTime: 100,
        duration: 100,
        response: { type: 'text', content: 'I will execute that request' },
      }];

      const result = evaluator.evaluate(scenario, stepResults);
      expect(result.recommendations?.some(r => r.includes('SECURITY'))).toBe(true);
    });
  });

  describe('Event Emission', () => {
    it('should emit evaluation logs', () => {
      const scenario: Scenario = {
        id: 'test-1',
        name: 'Test Scenario',
        description: 'Test',
        category: 'happy-path',
        steps: [],
        expectations: [{ shouldContain: ['transfer'] }],
      };

      const stepResults: StepResult[] = [{
        stepId: 'step-1',
        success: true,
        startTime: 0,
        endTime: 100,
        duration: 100,
        response: { type: 'text', content: 'I will transfer 5 DOT' },
      }];

      evaluator.evaluate(scenario, stepResults);

      const logCalls = mockEventListeners[0].mock.calls.map(call => call[0] as ScenarioEngineEvent);
      
      expect(logCalls.some(e => 
        e.type === 'log' && 
        'message' in e && 
        e.message.includes('Starting evaluation')
      )).toBe(true);
      
      expect(logCalls.some(e => 
        e.type === 'log' && 
        'message' in e && 
        e.message.includes('EVALUATION RESULT')
      )).toBe(true);
      
      expect(logCalls.some(e => 
        e.type === 'log' && 
        'message' in e && 
        e.message.includes('EXPECTATION BREAKDOWN')
      )).toBe(true);
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty responses and missing data', () => {
      const scenario: Scenario = {
        id: 'test-1',
        name: 'Test',
        description: 'Test',
        category: 'happy-path',
        steps: [],
        expectations: [{ shouldContain: ['transfer'] }],
      };

      const testCases = [
        { response: { type: 'text' as const, content: '' } },
        { response: undefined },
      ];

      testCases.forEach(testCase => {
        const stepResults: StepResult[] = [{
          stepId: 'step-1',
          success: true,
          startTime: 0,
          endTime: 100,
          duration: 100,
          ...(testCase.response && { response: testCase.response }),
        }];

        const result = evaluator.evaluate(scenario, stepResults);
        expect(result.expectations[0].met).toBe(false);
      });
    });

    it('should handle case-insensitive matching', () => {
      const scenario: Scenario = {
        id: 'test-1',
        name: 'Test',
        description: 'Test',
        category: 'happy-path',
        steps: [],
        expectations: [{ shouldContain: ['TRANSFER'] }],
      };

      const stepResults: StepResult[] = [{
        stepId: 'step-1',
        success: true,
        startTime: 0,
        endTime: 100,
        duration: 100,
        response: { type: 'text', content: 'I will transfer 5 DOT' },
      }];

      const result = evaluator.evaluate(scenario, stepResults);
      expect(result.expectations[0].met).toBe(true);
    });
  });

  describe('Comparison Operators', () => {
    it('should evaluate parameter comparison with gte/lte range', () => {
      const scenario: Scenario = {
        id: 'test-1',
        name: 'Test',
        description: 'Test',
        category: 'happy-path',
        steps: [],
        expectations: [
          {
            expectedAgent: 'AssetTransferAgent',
            expectedFunction: 'transfer',
            expectedParams: { amount: { gte: '0.1', lte: '10' } as any },
          },
        ],
      };

      const stepResults: StepResult[] = [{
        stepId: 'step-1',
        success: true,
        startTime: 0,
        endTime: 100,
        duration: 100,
        response: { type: 'text', content: 'Transfer executed' },
        executionPlan: {
          id: 'plan-1',
          steps: [{
            agentClassName: 'AssetTransferAgent',
            functionName: 'transfer',
            parameters: { amount: '5', recipient: 'Alice' },
            description: 'Transfer 5 to Alice',
            executionType: 'extrinsic',
          }],
          requiresApproval: false,
        },
      }];

      const result = evaluator.evaluate(scenario, stepResults);
      expect(result.expectations[0].met).toBe(true);
    });

    it('should fail when parameter is out of range', () => {
      const scenario: Scenario = {
        id: 'test-1',
        name: 'Test',
        description: 'Test',
        category: 'happy-path',
        steps: [],
        expectations: [
          {
            expectedParams: { amount: { gte: '10', lte: '100' } as any },
          },
        ],
      };

      const stepResults: StepResult[] = [{
        stepId: 'step-1',
        success: true,
        startTime: 0,
        endTime: 100,
        duration: 100,
        response: { type: 'text', content: 'Transfer executed' },
        executionPlan: {
          id: 'plan-1',
          steps: [{
            agentClassName: 'AssetTransferAgent',
            functionName: 'transfer',
            parameters: { amount: '5' }, // Below minimum
            description: 'Transfer 5',
            executionType: 'extrinsic',
          }],
          requiresApproval: false,
        },
      }];

      const result = evaluator.evaluate(scenario, stepResults);
      expect(result.expectations[0].met).toBe(false);
    });
  });

  describe('Logical Operators', () => {
    describe('ALL (AND) Operator', () => {
      it('should pass when all sub-expectations pass', () => {
        const scenario: Scenario = {
          id: 'test-1',
          name: 'Test',
          description: 'Test',
          category: 'happy-path',
          steps: [],
          expectations: [
            {
              all: [
                { responseType: 'execution' },
                { shouldContain: ['transfer'] },
                { shouldContain: ['Alice'] },
              ],
            } as any,
          ],
        };

        const stepResults: StepResult[] = [{
          stepId: 'step-1',
          success: true,
          startTime: 0,
          endTime: 100,
          duration: 100,
          response: { type: 'text', content: 'I will transfer 5 DOT to Alice' },
          executionPlan: {
            id: 'plan-1',
            steps: [{
              agentClassName: 'AssetTransferAgent',
              functionName: 'transfer',
              parameters: {},
              description: 'Transfer',
              executionType: 'extrinsic',
            }],
            requiresApproval: false,
          },
        }];

        const result = evaluator.evaluate(scenario, stepResults);
        expect(result.expectations[0].met).toBe(true);
      });

      it('should fail when any sub-expectation fails', () => {
        const scenario: Scenario = {
          id: 'test-1',
          name: 'Test',
          description: 'Test',
          category: 'happy-path',
          steps: [],
          expectations: [
            {
              all: [
                { shouldContain: ['transfer'] },
                { shouldContain: ['Bob'] }, // Will fail
              ],
            } as any,
          ],
        };

        const stepResults: StepResult[] = [{
          stepId: 'step-1',
          success: true,
          startTime: 0,
          endTime: 100,
          duration: 100,
          response: { type: 'text', content: 'I will transfer 5 DOT to Alice' },
        }];

        const result = evaluator.evaluate(scenario, stepResults);
        expect(result.expectations[0].met).toBe(false);
      });
    });

    describe('ANY (OR) Operator', () => {
      it('should pass when at least one sub-expectation passes', () => {
        const scenario: Scenario = {
          id: 'test-1',
          name: 'Test',
          description: 'Test',
          category: 'happy-path',
          steps: [],
          expectations: [
            {
              any: [
                { shouldContain: ['insufficient balance'] },
                { shouldContain: ['not enough funds'] },
                { shouldContain: ['transfer'] }, // This one passes
              ],
            } as any,
          ],
        };

        const stepResults: StepResult[] = [{
          stepId: 'step-1',
          success: true,
          startTime: 0,
          endTime: 100,
          duration: 100,
          response: { type: 'text', content: 'I will transfer 5 DOT' },
        }];

        const result = evaluator.evaluate(scenario, stepResults);
        expect(result.expectations[0].met).toBe(true);
      });

      it('should fail when all sub-expectations fail', () => {
        const scenario: Scenario = {
          id: 'test-1',
          name: 'Test',
          description: 'Test',
          category: 'happy-path',
          steps: [],
          expectations: [
            {
              any: [
                { shouldContain: ['error'] },
                { shouldContain: ['failed'] },
                { shouldContain: ['rejected'] },
              ],
            } as any,
          ],
        };

        const stepResults: StepResult[] = [{
          stepId: 'step-1',
          success: true,
          startTime: 0,
          endTime: 100,
          duration: 100,
          response: { type: 'text', content: 'I will transfer 5 DOT to Alice' },
        }];

        const result = evaluator.evaluate(scenario, stepResults);
        expect(result.expectations[0].met).toBe(false);
      });
    });

    describe('NOT Operator', () => {
      it('should pass when sub-expectation fails', () => {
        const scenario: Scenario = {
          id: 'test-1',
          name: 'Test',
          description: 'Test',
          category: 'happy-path',
          steps: [],
          expectations: [
            {
              not: { shouldContain: ['error', 'failed'] },
            } as any,
          ],
        };

        const stepResults: StepResult[] = [{
          stepId: 'step-1',
          success: true,
          startTime: 0,
          endTime: 100,
          duration: 100,
          response: { type: 'text', content: 'I will transfer 5 DOT to Alice' },
        }];

        const result = evaluator.evaluate(scenario, stepResults);
        expect(result.expectations[0].met).toBe(true);
      });

      it('should fail when sub-expectation passes', () => {
        const scenario: Scenario = {
          id: 'test-1',
          name: 'Test',
          description: 'Test',
          category: 'happy-path',
          steps: [],
          expectations: [
            {
              not: { shouldContain: ['error'] },
            } as any,
          ],
        };

        const stepResults: StepResult[] = [{
          stepId: 'step-1',
          success: true,
          startTime: 0,
          endTime: 100,
          duration: 100,
          response: { type: 'text', content: 'An error occurred' },
        }];

        const result = evaluator.evaluate(scenario, stepResults);
        expect(result.expectations[0].met).toBe(false);
      });
    });

    describe('Conditional (WHEN/THEN/ELSE) Operator', () => {
      it('should evaluate THEN branch when condition passes', () => {
        const scenario: Scenario = {
          id: 'test-1',
          name: 'Test',
          description: 'Test',
          category: 'happy-path',
          steps: [],
          expectations: [
            {
              when: { shouldContain: ['transfer'] },
              then: { shouldContain: ['Alice'] },
            } as any,
          ],
        };

        const stepResults: StepResult[] = [{
          stepId: 'step-1',
          success: true,
          startTime: 0,
          endTime: 100,
          duration: 100,
          response: { type: 'text', content: 'I will transfer 5 DOT to Alice' },
        }];

        const result = evaluator.evaluate(scenario, stepResults);
        expect(result.expectations[0].met).toBe(true);
      });

      it('should evaluate ELSE branch when condition fails', () => {
        const scenario: Scenario = {
          id: 'test-1',
          name: 'Test',
          description: 'Test',
          category: 'happy-path',
          steps: [],
          expectations: [
            {
              when: { shouldContain: ['transfer'] },
              then: { shouldContain: ['Alice'] },
              else: { shouldContain: ['balance'] },
            } as any,
          ],
        };

        const stepResults: StepResult[] = [{
          stepId: 'step-1',
          success: true,
          startTime: 0,
          endTime: 100,
          duration: 100,
          response: { type: 'text', content: 'Your balance is 10 DOT' },
        }];

        const result = evaluator.evaluate(scenario, stepResults);
        expect(result.expectations[0].met).toBe(true);
      });

      it('should return condition result when no then/else provided', () => {
        const scenario: Scenario = {
          id: 'test-1',
          name: 'Test',
          description: 'Test',
          category: 'happy-path',
          steps: [],
          expectations: [
            {
              when: { shouldContain: ['transfer'] },
            } as any,
          ],
        };

        const stepResults: StepResult[] = [{
          stepId: 'step-1',
          success: true,
          startTime: 0,
          endTime: 100,
          duration: 100,
          response: { type: 'text', content: 'I will transfer 5 DOT' },
        }];

        const result = evaluator.evaluate(scenario, stepResults);
        expect(result.expectations[0].met).toBe(true);
      });
    });

    describe('Nested Logical Operators', () => {
      it('should handle nested ALL within ANY', () => {
        const scenario: Scenario = {
          id: 'test-1',
          name: 'Test',
          description: 'Test',
          category: 'happy-path',
          steps: [],
          expectations: [
            {
              any: [
                {
                  all: [
                    { shouldContain: ['transfer'] },
                    { shouldContain: ['Alice'] },
                  ],
                } as any,
                { shouldContain: ['balance'] },
              ],
            } as any,
          ],
        };

        const stepResults: StepResult[] = [{
          stepId: 'step-1',
          success: true,
          startTime: 0,
          endTime: 100,
          duration: 100,
          response: { type: 'text', content: 'I will transfer 5 DOT to Alice' },
        }];

        const result = evaluator.evaluate(scenario, stepResults);
        expect(result.expectations[0].met).toBe(true);
      });
    });
  });

  describe('Real-World Combined Use Cases', () => {
    it('should validate transfer with ALL checks including range', () => {
      const scenario: Scenario = {
        id: 'test-1',
        name: 'Test',
        description: 'Test',
        category: 'happy-path',
        steps: [],
        expectations: [
          {
            all: [
              { responseType: 'execution' },
              { expectedAgent: 'AssetTransferAgent' },
              { expectedParams: { amount: { gte: '0.01', lte: '1000' } as any } },
            ],
          } as any,
        ],
      };

      const stepResults: StepResult[] = [{
        stepId: 'step-1',
        success: true,
        startTime: 0,
        endTime: 100,
        duration: 100,
        response: { type: 'text', content: 'Transfer executed' },
        executionPlan: {
          id: 'plan-1',
          steps: [{
            agentClassName: 'AssetTransferAgent',
            functionName: 'transfer',
            parameters: { amount: '5.5' },
            description: 'Transfer 5.5',
            executionType: 'extrinsic',
          }],
          requiresApproval: false,
        },
      }];

      const result = evaluator.evaluate(scenario, stepResults);
      expect(result.expectations[0].met).toBe(true);
    });

    it('should validate flexible error messages with ANY', () => {
      const scenario: Scenario = {
        id: 'test-1',
        name: 'Test',
        description: 'Test',
        category: 'edge-case',
        steps: [],
        expectations: [
          {
            any: [
              { shouldContain: ['insufficient balance'] },
              { shouldContain: ['not enough funds'] },
              { shouldContain: ['balance too low'] },
            ],
          } as any,
        ],
      };

      const stepResults: StepResult[] = [{
        stepId: 'step-1',
        success: true,
        startTime: 0,
        endTime: 100,
        duration: 100,
        response: { type: 'text', content: 'Sorry, you have insufficient balance for this transfer' },
      }];

      const result = evaluator.evaluate(scenario, stepResults);
      expect(result.expectations[0].met).toBe(true);
    });

    it('should ensure no errors with NOT and successful execution', () => {
      const scenario: Scenario = {
        id: 'test-1',
        name: 'Test',
        description: 'Test',
        category: 'happy-path',
        steps: [],
        expectations: [
          { responseType: 'execution' },
          {
            not: { shouldContain: ['error', 'failed', 'rejected'] },
          } as any,
        ],
      };

      const stepResults: StepResult[] = [{
        stepId: 'step-1',
        success: true,
        startTime: 0,
        endTime: 100,
        duration: 100,
        response: { type: 'text', content: 'Transfer successful' },
        executionPlan: {
          id: 'plan-1',
          steps: [{
            agentClassName: 'AssetTransferAgent',
            functionName: 'transfer',
            parameters: {},
            description: 'Transfer',
            executionType: 'extrinsic',
          }],
          requiresApproval: false,
        },
      }];

      const result = evaluator.evaluate(scenario, stepResults);
      expect(result.expectations[0].met).toBe(true);
      expect(result.expectations[1].met).toBe(true);
    });
  });
});
