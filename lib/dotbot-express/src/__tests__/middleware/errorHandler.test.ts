/**
 * Unit tests for Error Handler Middleware
 */

import { Request, Response, NextFunction } from 'express';
import { errorHandler, notFoundHandler, APIError } from '../../middleware/errorHandler';

describe('Error Handler Middleware', () => {
  let mockRequest: Partial<Request>;
  let mockResponse: Partial<Response>;
  let mockNext: NextFunction;
  let originalEnv: string | undefined;

  beforeEach(() => {
    originalEnv = process.env.NODE_ENV;
    mockRequest = {
      method: 'POST',
      path: '/api/test',
    } as Request;

    mockResponse = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };

    mockNext = jest.fn();
  });

  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
  });

  describe('errorHandler()', () => {
    it('should handle error with default status code 500', () => {
      const error = new Error('Test error');
      process.env.NODE_ENV = 'production';

      errorHandler(error as APIError, mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockResponse.status).toHaveBeenCalledWith(500);
      expect(mockResponse.json).toHaveBeenCalledWith({
        error: true,
        message: 'Test error',
        code: undefined,
        path: '/api/test',
        timestamp: expect.any(String),
      });
    });

    it('should use custom status code from error', () => {
      const error: APIError = new Error('Not found');
      error.statusCode = 404;
      process.env.NODE_ENV = 'production';

      errorHandler(error, mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockResponse.status).toHaveBeenCalledWith(404);
      expect(mockResponse.json).toHaveBeenCalledWith({
        error: true,
        message: 'Not found',
        code: undefined,
        path: '/api/test',
        timestamp: expect.any(String),
      });
    });

    it('should include error code if provided', () => {
      const error: APIError = new Error('Validation failed');
      error.statusCode = 400;
      error.code = 'VALIDATION_ERROR';
      process.env.NODE_ENV = 'production';

      errorHandler(error, mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockResponse.json).toHaveBeenCalledWith({
        error: true,
        message: 'Validation failed',
        code: 'VALIDATION_ERROR',
        path: '/api/test',
        timestamp: expect.any(String),
      });
    });

    it('should include stack trace in development mode', () => {
      const error = new Error('Test error');
      process.env.NODE_ENV = 'development';

      errorHandler(error as APIError, mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: true,
          message: 'Test error',
          stack: expect.any(String),
        })
      );
    });

    it('should not include stack trace in production mode', () => {
      const error = new Error('Test error');
      process.env.NODE_ENV = 'production';

      errorHandler(error as APIError, mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.not.objectContaining({
          stack: expect.anything(),
        })
      );
    });

    it('should use default message if error message is empty', () => {
      const error = new Error('');
      process.env.NODE_ENV = 'production';

      errorHandler(error as APIError, mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Internal server error',
        })
      );
    });

    it('should log error details', () => {
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
      const error = new Error('Test error');
      process.env.NODE_ENV = 'production';

      errorHandler(error as APIError, mockRequest as Request, mockResponse as Response, mockNext);

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        '[Error Handler]',
        expect.objectContaining({
          method: 'POST',
          path: '/api/test',
          error: 'Test error',
        })
      );

      consoleErrorSpy.mockRestore();
    });
  });

  describe('notFoundHandler()', () => {
    it('should return 404 with route information', () => {
      mockRequest = {
        method: 'GET',
        path: '/api/nonexistent',
      } as Request;

      notFoundHandler(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockResponse.status).toHaveBeenCalledWith(404);
      expect(mockResponse.json).toHaveBeenCalledWith({
        error: true,
        message: 'Route not found: GET /api/nonexistent',
        code: 'NOT_FOUND',
        timestamp: expect.any(String),
      });
    });

    it('should include method and path in error message', () => {
      mockRequest = {
        method: 'POST',
        path: '/api/custom/endpoint',
      } as Request;

      notFoundHandler(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Route not found: POST /api/custom/endpoint',
        })
      );
    });
  });
});
