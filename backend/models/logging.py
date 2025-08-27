from enum import Enum


class Subsystem(str, Enum):
    """Backend subsystem identifiers for logging"""
    # Core application
    APP = "app"
    API = "api"
    
    # Services
    MEMORY = "memory"
    PAYMENT = "payment"
    
    # External integrations
    AGENT_COMM = "agent-comm"
    DATABASE = "database"
    
    # Infrastructure
    HEALTH = "health"
    UTILS = "utils"


class ErrorType(str, Enum):
    """Error type classifications for structured logging"""
    # Database errors
    DATABASE_CONNECTION = "databaseConnection"
    DATABASE_QUERY = "databaseQuery"
    
    # Agent communication errors
    AGENT_TIMEOUT = "agentTimeout"
    AGENT_UNAVAILABLE = "agentUnavailable"
    INVALID_AGENT_RESPONSE = "invalidAgentResponse"
    
    # Payment errors
    PAYMENT_FAILED = "paymentFailed"
    PAYMENT_INVALID = "paymentInvalid"
    
    # API errors
    INVALID_REQUEST = "invalidRequest"
    AUTHENTICATION_FAILED = "authenticationFailed"
    RATE_LIMITED = "rateLimited"
    
    # Infrastructure errors
    NETWORK_ERROR = "networkError"
    TIMEOUT = "timeout"
    CONFIGURATION_ERROR = "configurationError" 