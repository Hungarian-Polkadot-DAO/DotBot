import os
import sys
import logging
import structlog
from typing import Optional, Dict, Any
from colorama import init, Fore, Style

# Import our models (using absolute import)
from models.logging import Subsystem, ErrorType

# Initialize colorama for Windows compatibility
init()

# Read version - try to get from environment or use fallback
APP_VERSION = os.getenv("APP_VERSION", "1.0.0-fallback")

# Detect environment
is_production = os.getenv("NODE_ENV") == "production"
is_development = os.getenv("NODE_ENV") == "development"
log_level = os.getenv("LOG_LEVEL", "INFO" if is_production else "DEBUG")

# Custom renderer for development with colors
def colored_console_renderer(logger, method_name, event_dict):
    """Custom renderer for colored console output in development"""
    if not is_development:
        return structlog.dev.ConsoleRenderer()(logger, method_name, event_dict)
    
    # Color mapping for log levels
    colors = {
        'debug': Fore.CYAN,
        'info': Fore.GREEN,
        'warning': Fore.YELLOW,
        'error': Fore.RED,
        'critical': Fore.MAGENTA,
    }
    
    level_color = colors.get(method_name, '')
    reset = Style.RESET_ALL
    
    # Format the message with colors
    timestamp = event_dict.get('timestamp', '')
    subsystem = event_dict.get('subsystem', 'unknown')
    message = event_dict.get('event', '')
    
    return f"{Fore.BLUE}{timestamp}{reset} {level_color}[{method_name.upper()}]{reset} {Fore.MAGENTA}({subsystem}){reset} {message}"


# Configure structlog
structlog.configure(
    processors=[
        # Add log level to event dict
        structlog.stdlib.filter_by_level,
        # Add logger name to event dict
        structlog.stdlib.add_logger_name,
        # Add log level to event dict
        structlog.stdlib.add_log_level,
        # Perform %-style formatting
        structlog.stdlib.PositionalArgumentsFormatter(),
        # Add timestamp
        structlog.processors.TimeStamper(fmt="iso"),
        # Add stack info if exception occurred
        structlog.processors.StackInfoRenderer(),
        # Format exceptions
        structlog.processors.format_exc_info,
        # Unicode handling
        structlog.processors.UnicodeDecoder(),
        # Add base fields
        structlog.processors.add_log_level,
        # Choose renderer based on environment
        colored_console_renderer if is_development else structlog.processors.JSONRenderer()
    ],
    context_class=dict,
    logger_factory=structlog.stdlib.LoggerFactory(),
    wrapper_class=structlog.stdlib.BoundLogger,
    cache_logger_on_first_use=True,
)

# Configure standard library logging
logging.basicConfig(
    format="%(message)s",
    stream=sys.stdout,
    level=getattr(logging, log_level.upper(), logging.INFO),
)

# Create base logger with common fields
base_logger = structlog.get_logger().bind(
    service="DotBot-Backend",
    version=APP_VERSION,
    environment=os.getenv("NODE_ENV", "development"),
    hostname=os.uname().nodename if hasattr(os, 'uname') else 'unknown'
)


def create_subsystem_logger(subsystem: Subsystem) -> structlog.BoundLogger:
    """Create a logger for a specific subsystem"""
    return base_logger.bind(subsystem=subsystem.value)


def log_error(
    subsystem_logger: structlog.BoundLogger,
    context: Dict[str, Any],
    message: str,
    error_type: Optional[ErrorType] = None
) -> None:
    """Helper function for critical errors with types"""
    log_context = dict(context)
    if error_type:
        log_context["type"] = error_type.value
    
    subsystem_logger.error(message, **log_context)


# Export the base logger and convenience logger
logger = base_logger 