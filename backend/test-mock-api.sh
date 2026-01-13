#!/bin/bash

# Test script for DotBot Mock API Server
# This script tests all the main endpoints to verify the mock server is working

BASE_URL="http://localhost:8000"
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo "======================================"
echo "DotBot Mock API Server Test Script"
echo "======================================"
echo ""

# Function to test an endpoint
test_endpoint() {
    local method=$1
    local endpoint=$2
    local data=$3
    local description=$4
    
    echo -e "${YELLOW}Testing:${NC} $description"
    echo -e "${YELLOW}Endpoint:${NC} $method $endpoint"
    
    if [ "$method" = "GET" ]; then
        response=$(curl -s -w "\n%{http_code}" "$BASE_URL$endpoint")
    else
        response=$(curl -s -w "\n%{http_code}" -X "$method" "$BASE_URL$endpoint" \
            -H "Content-Type: application/json" \
            -d "$data")
    fi
    
    http_code=$(echo "$response" | tail -n 1)
    body=$(echo "$response" | head -n -1)
    
    if [ "$http_code" -ge 200 ] && [ "$http_code" -lt 300 ]; then
        echo -e "${GREEN}✓ Success${NC} (HTTP $http_code)"
        echo "$body" | python3 -m json.tool 2>/dev/null || echo "$body"
    else
        echo -e "${RED}✗ Failed${NC} (HTTP $http_code)"
        echo "$body"
    fi
    echo ""
}

# Test Health Endpoints
echo "=== Health & Status Endpoints ==="
echo ""

test_endpoint "GET" "/hello" "" "Hello World"

test_endpoint "GET" "/api/health" "" "Health Check"

test_endpoint "GET" "/api/status" "" "Detailed Status"

# Test Chat Endpoints
echo "=== Chat Endpoints ==="
echo ""

test_endpoint "POST" "/api/chat" \
'{
  "message": "What is Polkadot?",
  "provider": "asi-one"
}' \
"Simple Chat Message"

test_endpoint "GET" "/api/chat/providers" "" "Get AI Providers"

# Test DotBot Session Endpoints
echo "=== DotBot Session Endpoints ==="
echo ""

test_endpoint "POST" "/api/dotbot/session" \
'{
  "wallet": {
    "address": "5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY",
    "name": "Alice",
    "source": "polkadot-js"
  },
  "environment": "mainnet",
  "network": "polkadot"
}' \
"Create DotBot Session"

SESSION_ID="wallet:5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY:mainnet"

test_endpoint "GET" "/api/dotbot/session/$SESSION_ID" "" "Get Session Info"

# Test DotBot Chat
echo "=== DotBot Chat Endpoint ==="
echo ""

test_endpoint "POST" "/api/dotbot/chat" \
'{
  "message": "Transfer 1 DOT to Alice",
  "wallet": {
    "address": "5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY",
    "source": "polkadot-js"
  },
  "environment": "mainnet",
  "network": "polkadot"
}' \
"DotBot Chat (Transfer Request)"

# Test Chat Instance Management
echo "=== Chat Instance Management ==="
echo ""

test_endpoint "GET" "/api/dotbot/session/$SESSION_ID/chats" "" "List Chat Instances"

CHAT_ID="chat_1234567890"

test_endpoint "GET" "/api/dotbot/session/$SESSION_ID/chats/$CHAT_ID" "" "Get Chat Instance"

test_endpoint "POST" "/api/dotbot/session/$SESSION_ID/chats/$CHAT_ID/load" "" "Load Chat Instance"

# Test Execution Management
echo "=== Execution Management ==="
echo ""

EXECUTION_ID="exec_1234567890"

test_endpoint "POST" "/api/dotbot/session/$SESSION_ID/execution/$EXECUTION_ID/start" \
'{
  "autoApprove": false
}' \
"Start Execution"

test_endpoint "GET" "/api/dotbot/session/$SESSION_ID/execution/$EXECUTION_ID" "" "Get Execution State"

test_endpoint "POST" "/api/dotbot/session/$SESSION_ID/execution/$EXECUTION_ID/approve" \
'{
  "stepIndex": 0
}' \
"Approve Execution Step"

test_endpoint "POST" "/api/dotbot/session/$SESSION_ID/execution/$EXECUTION_ID/reject" \
'{
  "stepIndex": 0,
  "reason": "Test rejection"
}' \
"Reject Execution Step"

# Cleanup Tests
echo "=== Cleanup Endpoints ==="
echo ""

test_endpoint "DELETE" "/api/dotbot/session/$SESSION_ID/chats/$CHAT_ID" "" "Delete Chat Instance"

test_endpoint "DELETE" "/api/dotbot/session/$SESSION_ID" "" "Delete Session"

echo "======================================"
echo "Test Complete!"
echo "======================================"
