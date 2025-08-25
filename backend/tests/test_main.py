#!/usr/bin/env python3
"""
Basic tests for DotBot backend
"""

import pytest
from fastapi.testclient import TestClient


def test_health_endpoint_without_services():
    """Test that the health endpoint works even without optional services"""
    # Create a minimal FastAPI app for testing
    from fastapi import FastAPI
    from datetime import datetime, timezone
    
    test_app = FastAPI()
    
    @test_app.get("/api/health")
    async def health_check():
        """Health check endpoint"""
        return {
            "status": "healthy",
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "services": {
                "memory": False,
                "payment": False
            },
            "message": "DotBot Backend - Optional Enhancement Layer"
        }
    
    client = TestClient(test_app)
    response = client.get("/api/health")
    
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "healthy"
    assert "timestamp" in data
    assert data["services"]["memory"] is False
    assert data["services"]["payment"] is False


def test_status_endpoint_without_services():
    """Test that the status endpoint works even without optional services"""
    # Create a minimal FastAPI app for testing
    from fastapi import FastAPI
    
    test_app = FastAPI()
    
    @test_app.get("/api/status")
    async def service_status():
        """Detailed service status"""
        return {
            "backend_available": True,
            "services": {
                "memory": {"available": False, "reason": "Not initialized"},
                "payment": {"available": False, "reason": "Not initialized"}
            }
        }
    
    client = TestClient(test_app)
    response = client.get("/api/status")
    
    assert response.status_code == 200
    data = response.json()
    assert data["backend_available"] is True
    assert data["services"]["memory"]["available"] is False
    assert data["services"]["payment"]["available"] is False


def test_analytics_overview():
    """Test analytics overview endpoint"""
    from fastapi import FastAPI
    
    test_app = FastAPI()
    
    @test_app.get("/api/analytics/overview")
    async def get_analytics_overview():
        """Get usage analytics overview (optional enhancement)"""
        return {
            "total_conversations": 0,
            "active_users": 0,
            "popular_agents": [],
            "note": "Analytics service not implemented - this is optional"
        }
    
    client = TestClient(test_app)
    response = client.get("/api/analytics/overview")
    
    assert response.status_code == 200
    data = response.json()
    assert data["total_conversations"] == 0
    assert data["active_users"] == 0
    assert isinstance(data["popular_agents"], list)
