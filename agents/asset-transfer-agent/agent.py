#!/usr/bin/env python3
"""
DotBot Asset Transfer Agent
Compatible with Fetch.ai AgentVerse and ASI-One

This agent handles DOT and token transfers across the Polkadot ecosystem.
Can be deployed to AgentVerse for use by any ASI-One chatbot.
"""

import asyncio
import json
import logging
from typing import Dict, Any, Optional
from dataclasses import dataclass

# Fetch.ai uAgent imports (when deployed to AgentVerse)
try:
    from uagents import Agent, Context, Model
    from uagents.setup import fund_agent_if_low
    AGENTVERSE_MODE = True
except ImportError:
    # Fallback for standalone mode
    AGENTVERSE_MODE = False
    print("Running in standalone mode - uAgents not available")

# Polkadot integration
try:
    from substrateinterface import SubstrateInterface, Keypair
    from substrateinterface.exceptions import SubstrateRequestException
    SUBSTRATE_AVAILABLE = True
except ImportError:
    SUBSTRATE_AVAILABLE = False
    print("Substrate interface not available - install polkadot dependencies")

@dataclass
class TransferRequest(Model):
    """Transfer request model for AgentVerse compatibility"""
    amount: str
    recipient: str
    asset: str = "DOT"
    network: str = "polkadot"
    sender_address: Optional[str] = None
    message_id: Optional[str] = None

@dataclass
class TransferResponse(Model):
    """Transfer response model for AgentVerse compatibility"""
    success: bool
    message: str
    transaction_data: Optional[Dict[str, Any]] = None
    error: Optional[str] = None
    requires_signature: bool = False

class AssetTransferAgent:
    def __init__(self, agent_id: str = "asset-transfer-agent"):
        self.agent_id = agent_id
        self.logger = logging.getLogger(agent_id)
        
        # Network configurations
        self.networks = {
            "polkadot": {
                "rpc_url": "wss://rpc.polkadot.io",
                "ss58_format": 0,
                "decimals": 10,
                "symbol": "DOT"
            },
            "kusama": {
                "rpc_url": "wss://kusama-rpc.polkadot.io",
                "ss58_format": 2,
                "decimals": 12,
                "symbol": "KSM"
            },
            "westend": {
                "rpc_url": "wss://westend-rpc.polkadot.io",
                "ss58_format": 42,
                "decimals": 12,
                "symbol": "WND"
            }
        }
        
        self.substrate_interfaces = {}
        
    async def initialize(self):
        """Initialize agent and connect to networks"""
        self.logger.info(f"Initializing {self.agent_id}")
        
        if SUBSTRATE_AVAILABLE:
            # Initialize Substrate connections
            for network, config in self.networks.items():
                try:
                    interface = SubstrateInterface(
                        url=config["rpc_url"],
                        ss58_format=config["ss58_format"]
                    )
                    self.substrate_interfaces[network] = interface
                    self.logger.info(f"Connected to {network}")
                except Exception as e:
                    self.logger.error(f"Failed to connect to {network}: {e}")
        
        self.logger.info("Asset Transfer Agent initialized successfully")

    async def parse_transfer_request(self, message: str) -> Optional[TransferRequest]:
        """Parse natural language transfer request"""
        # Simple parsing logic - in production, use more sophisticated NLP
        message_lower = message.lower()
        
        # Extract amount
        amount = None
        for word in message.split():
            try:
                if word.replace('.', '').replace(',', '').isdigit():
                    amount = word.replace(',', '')
                    break
            except:
                continue
        
        # Extract recipient (look for address-like patterns)
        recipient = None
        for word in message.split():
            if len(word) > 40 and word.startswith('5'):  # Polkadot address pattern
                recipient = word
                break
        
        # Simple alias handling
        aliases = {
            "alice": "5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY",
            "bob": "5FHneW46xGXgs5mUiveU4sbTyGBzmstUspZC92UhjJM694ty",
            "charlie": "5FLSigC9HGRKVhB9FiEo4Y3koPsNmBmLJbpXg2mp1hXcS59Y"
        }
        
        for alias, address in aliases.items():
            if alias in message_lower:
                recipient = address
                break
        
        # Extract asset type
        asset = "DOT"  # Default
        if "ksm" in message_lower or "kusama" in message_lower:
            asset = "KSM"
        elif "wnd" in message_lower or "westend" in message_lower:
            asset = "WND"
        
        # Determine network from asset
        network_map = {"DOT": "polkadot", "KSM": "kusama", "WND": "westend"}
        network = network_map.get(asset, "polkadot")
        
        if amount and recipient:
            return TransferRequest(
                amount=amount,
                recipient=recipient,
                asset=asset,
                network=network
            )
        
        return None

    async def prepare_transfer(self, request: TransferRequest) -> TransferResponse:
        """Prepare transfer transaction for user signing"""
        try:
            network_config = self.networks.get(request.network)
            if not network_config:
                return TransferResponse(
                    success=False,
                    error=f"Unsupported network: {request.network}"
                )
            
            # Convert amount to planck units
            decimals = network_config["decimals"]
            amount_planck = int(float(request.amount) * (10 ** decimals))
            
            # Validate recipient address
            if not self._validate_address(request.recipient, network_config["ss58_format"]):
                return TransferResponse(
                    success=False,
                    error="Invalid recipient address format"
                )
            
            # Prepare transaction data
            transaction_data = {
                "pallet": "Balances",
                "call": "transfer",
                "args": {
                    "dest": {"Id": request.recipient},
                    "value": amount_planck
                },
                "network": request.network,
                "amount_display": f"{request.amount} {request.asset}",
                "recipient_display": request.recipient,
                "estimated_fee": "0.01 DOT"  # Placeholder - calculate actual fee
            }
            
            # Get current balance if interface available
            balance_info = await self._get_balance(request.sender_address, request.network) if request.sender_address else None
            
            return TransferResponse(
                success=True,
                message=f"Transfer prepared: {request.amount} {request.asset} to {request.recipient[:8]}...",
                transaction_data=transaction_data,
                requires_signature=True
            )
            
        except Exception as e:
            self.logger.error(f"Error preparing transfer: {e}")
            return TransferResponse(
                success=False,
                error=f"Failed to prepare transfer: {str(e)}"
            )

    async def _get_balance(self, address: str, network: str) -> Optional[Dict[str, Any]]:
        """Get account balance"""
        if not SUBSTRATE_AVAILABLE or network not in self.substrate_interfaces:
            return None
        
        try:
            interface = self.substrate_interfaces[network]
            result = interface.query('System', 'Account', [address])
            
            if result:
                free = result.value['data']['free']
                reserved = result.value['data']['reserved']
                frozen = result.value['data']['frozen']
                
                network_config = self.networks[network]
                decimals = network_config["decimals"]
                
                return {
                    "free": free / (10 ** decimals),
                    "reserved": reserved / (10 ** decimals),
                    "frozen": frozen / (10 ** decimals),
                    "total": (free + reserved) / (10 ** decimals),
                    "symbol": network_config["symbol"]
                }
        except Exception as e:
            self.logger.error(f"Error getting balance: {e}")
        
        return None

    def _validate_address(self, address: str, ss58_format: int) -> bool:
        """Validate Substrate address"""
        try:
            if SUBSTRATE_AVAILABLE:
                from substrateinterface.utils.ss58 import ss58_decode
                ss58_decode(address, valid_ss58_format=ss58_format)
                return True
            else:
                # Basic validation without substrate
                return len(address) > 40 and address.startswith('5')
        except:
            return False

    async def process_message(self, message: str, context: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """Process incoming message (AgentVerse compatible)"""
        try:
            # Parse the transfer request
            transfer_request = await self.parse_transfer_request(message)
            
            if not transfer_request:
                return {
                    "success": False,
                    "message": "I couldn't understand the transfer request. Please specify amount, recipient, and asset type.",
                    "suggestions": [
                        "Send 5 DOT to Alice",
                        "Transfer 10 DOT to 5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY",
                        "Send 2.5 KSM to Bob"
                    ]
                }
            
            # Add sender address from context if available
            if context and context.get("sender_address"):
                transfer_request.sender_address = context["sender_address"]
            
            # Prepare the transfer
            response = await self.prepare_transfer(transfer_request)
            
            return {
                "success": response.success,
                "message": response.message,
                "transaction_data": response.transaction_data,
                "error": response.error,
                "requires_signature": response.requires_signature,
                "agent_id": self.agent_id
            }
            
        except Exception as e:
            self.logger.error(f"Error processing message: {e}")
            return {
                "success": False,
                "message": "I encountered an error processing your request. Please try again.",
                "error": str(e),
                "agent_id": self.agent_id
            }

# AgentVerse integration (when running in AgentVerse)
if AGENTVERSE_MODE:
    # Create uAgent instance
    agent = Agent(
        name="asset_transfer_agent",
        seed="asset_transfer_secret_seed",  # Use secure seed in production
        port=8001,
        endpoint=["http://localhost:8001/submit"]
    )
    
    # Initialize our agent class
    transfer_agent = AssetTransferAgent()
    
    @agent.on_event("startup")
    async def startup(ctx: Context):
        await transfer_agent.initialize()
        ctx.logger.info("Asset Transfer Agent started in AgentVerse mode")
    
    @agent.on_message(model=TransferRequest)
    async def handle_transfer_request(ctx: Context, sender: str, msg: TransferRequest):
        response = await transfer_agent.prepare_transfer(msg)
        await ctx.send(sender, response)
    
    # Generic message handler for natural language
    @agent.on_message(model=str)
    async def handle_message(ctx: Context, sender: str, msg: str):
        result = await transfer_agent.process_message(msg)
        await ctx.send(sender, result)

# Standalone mode (for testing and direct integration)
async def main():
    """Main function for standalone mode"""
    agent = AssetTransferAgent()
    await agent.initialize()
    
    # Test the agent
    test_message = "Send 5 DOT to Alice"
    result = await agent.process_message(test_message)
    print(json.dumps(result, indent=2))

if __name__ == "__main__":
    if AGENTVERSE_MODE:
        agent.run()
    else:
        asyncio.run(main())
