#!/usr/bin/env python3
"""
DotBot Backend - Optional Memory & Payment Layer

This backend provides enhanced functionality but is NOT required for core operations.
The frontend can work completely independently with direct agent communication.
"""

from fastapi import FastAPI, HTTPException, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
import uvicorn
from typing import Optional, Dict, Any
from datetime import datetime, timezone

# ABSOLUTE IMPORTS ONLY - NO RELATIVE IMPORTS - FORCED REBUILD v3.1 - Testing clean deployment
from services.memory_service import MemoryService
from services.payment_service import PaymentService
from config.logger import create_subsystem_logger
from models.logging import Subsystem

# Initialize logger for the main app
logger = create_subsystem_logger(Subsystem.APP)

# Create FastAPI app
app = FastAPI(
    title="DotBot Backend",
    description="Optional memory and payment layer for DotBot",
    version="1.0.0",
    docs_url="/api/docs",
    redoc_url="/api/redoc"
)

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Configure appropriately for production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Services (initialized as None, will be created if needed)
memory_service: Optional[MemoryService] = None
payment_service: Optional[PaymentService] = None

@app.on_event("startup")
async def startup_event():
    """Initialize optional services"""
    global memory_service, payment_service
    
    logger.info("DotBot Backend starting up - Hello World from logging system!")
    logger.info("Starting DotBot Backend (Optional Services)")
    
    try:
        # Initialize memory service (optional)
        logger.debug("Initializing memory service")
        memory_service = MemoryService()
        await memory_service.initialize()
        logger.info("Memory service initialized", service="memory", status="active")
    except Exception as e:
        logger.warning("Memory service not available", service="memory", status="disabled", error=str(e))
        memory_service = None
    
    try:
        # Initialize payment service (optional)
        payment_service = PaymentService()
        await payment_service.initialize()
        logger.info("Payment service initialized")
    except Exception as e:
        logger.warning(f"Payment service not available: {e}")
        payment_service = None
    
    logger.info("Backend startup complete")

@app.get("/api/health")
async def health_check():
    """Health check endpoint"""
    return {
        "status": "healthy",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "services": {
            "memory": memory_service is not None,
            "payment": payment_service is not None
        },
        "message": "DotBot Backend - Optional Enhancement Layer"
    }

@app.get("/api/status")
async def service_status():
    """Detailed service status"""
    status = {
        "backend_available": True,
        "services": {}
    }
    
    if memory_service:
        status["services"]["memory"] = await memory_service.get_status()
    else:
        status["services"]["memory"] = {"available": False, "reason": "Not initialized"}
    
    if payment_service:
        status["services"]["payment"] = await payment_service.get_status()
    else:
        status["services"]["payment"] = {"available": False, "reason": "Not initialized"}
    
    return status

# Memory Service Endpoints (Optional)
@app.post("/api/memory/conversations")
async def save_conversation(conversation_data: Dict[str, Any]):
    """Save conversation to memory (optional enhancement)"""
    if not memory_service:
        return JSONResponse(
            status_code=503,
            content={"error": "Memory service not available", "fallback": "Use local storage"}
        )
    
    try:
        result = await memory_service.save_conversation(conversation_data)
        return {"success": True, "conversation_id": result}
    except Exception as e:
        logger.error(f"Error saving conversation: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/memory/conversations/{user_id}")
async def get_conversations(user_id: str, limit: int = 50):
    """Retrieve conversation history (optional enhancement)"""
    if not memory_service:
        return JSONResponse(
            status_code=503,
            content={"error": "Memory service not available", "fallback": "Use local storage"}
        )
    
    try:
        conversations = await memory_service.get_conversations(user_id, limit)
        return {"conversations": conversations}
    except Exception as e:
        logger.error(f"Error retrieving conversations: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/memory/preferences/{user_id}")
async def save_user_preferences(user_id: str, preferences: Dict[str, Any]):
    """Save user preferences (optional enhancement)"""
    if not memory_service:
        return JSONResponse(
            status_code=503,
            content={"error": "Memory service not available", "fallback": "Use local storage"}
        )
    
    try:
        await memory_service.save_preferences(user_id, preferences)
        return {"success": True}
    except Exception as e:
        logger.error(f"Error saving preferences: {e}")
        raise HTTPException(status_code=500, detail=str(e))

# Payment Service Endpoints (Optional)
@app.post("/api/payments/process")
async def process_payment(payment_data: Dict[str, Any]):
    """Process payment for premium features (optional enhancement)"""
    if not payment_service:
        return JSONResponse(
            status_code=503,
            content={"error": "Payment service not available", "fallback": "Use free tier"}
        )
    
    try:
        result = await payment_service.process_payment(payment_data)
        return result
    except Exception as e:
        logger.error(f"Error processing payment: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/payments/usage/{user_id}")
async def get_usage_stats(user_id: str):
    """Get usage statistics (optional enhancement)"""
    if not payment_service:
        return {"usage": "unlimited", "tier": "free"}
    
    try:
        usage = await payment_service.get_usage_stats(user_id)
        return usage
    except Exception as e:
        logger.error(f"Error getting usage stats: {e}")
        raise HTTPException(status_code=500, detail=str(e))

# Agent Communication Proxy (Optional Enhancement)
@app.post("/api/agents/{agent_id}/message")
async def proxy_agent_message(agent_id: str, message_data: Dict[str, Any]):
    """
    Optional proxy for agent communication with enhanced features:
    - Caching
    - Analytics
    - Rate limiting
    - Response enhancement
    
    Frontend can bypass this and communicate directly with agents.
    """
    logger.info(f"Proxying message to agent {agent_id}")
    
    # Add any backend enhancements here
    enhanced_message = {
        **message_data,
        "backend_enhanced": True,
        "timestamp": datetime.now(timezone.utc).isoformat()
    }
    
    # TODO: Forward to actual agent
    # For now, return a mock response indicating backend enhancement
    return {
        "message": f"Backend-enhanced response for agent {agent_id}",
        "original_message": message_data.get("message"),
        "enhanced_features": {
            "caching": True,
            "analytics": True,
            "rate_limiting": True
        },
        "note": "Frontend can communicate directly with agents without this proxy"
    }

# Analytics Endpoints (Optional)
@app.get("/api/analytics/overview")
async def get_analytics_overview():
    """Get usage analytics overview (optional enhancement)"""
    return {
        "total_conversations": 0,
        "active_users": 0,
        "popular_agents": [],
        "note": "Analytics service not implemented - this is optional"
    }

if __name__ == "__main__":
    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=8000,
        reload=True,
        log_level="info"
    )
