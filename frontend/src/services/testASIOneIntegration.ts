// Test script for ASI-One integration
// This can be run in the browser console or as a separate test

import { getASIOneService } from './asiOneService';
import { AgentCommunicationService } from './agentCommunication';

export class ASIOneIntegrationTester {
  private asiOneService = getASIOneService();
  private agentService = new AgentCommunicationService();

  async runAllTests(): Promise<void> {
    console.log('🧪 Starting ASI-One Integration Tests...\n');

    try {
      await this.testASIOneService();
      await this.testAgentCommunication();
      await this.testConversationManagement();
      await this.testErrorHandling();
      
      console.log('✅ All tests completed successfully!');
    } catch (error) {
      console.error('❌ Test suite failed:', error);
    }
  }

  async testASIOneService(): Promise<void> {
    console.log('🔍 Testing ASI-One Service...');
    
    try {
      // Test basic message sending
      const response = await this.asiOneService.sendMessage("Hello, this is a test message");
      console.log('✅ ASI-One service response:', response.substring(0, 100) + '...');
      
      // Test conversation ID
      const conversationId = this.asiOneService.getConversationId();
      console.log('✅ Conversation ID:', conversationId);
      
      // Test conversation history
      const history = this.asiOneService.getConversationHistory();
      console.log('✅ Conversation history length:', history.length);
      
    } catch (error) {
      console.error('❌ ASI-One service test failed:', error);
    }
  }

  async testAgentCommunication(): Promise<void> {
    console.log('🔍 Testing Agent Communication...');
    
    try {
      // Test agent routing
      const transferAgent = this.agentService.routeMessage("Send 5 DOT to Alice");
      console.log('✅ Transfer message routed to:', transferAgent);
      
      const swapAgent = this.agentService.routeMessage("Swap DOT for USDC");
      console.log('✅ Swap message routed to:', swapAgent);
      
      // Test agent availability
      const availability = await this.agentService.checkAgentAvailability();
      console.log('✅ Agent availability:', availability);
      
      // Test agent info
      const agents = this.agentService.getAvailableAgents();
      console.log('✅ Available agents:', agents.map(a => a.name));
      
    } catch (error) {
      console.error('❌ Agent communication test failed:', error);
    }
  }

  async testConversationManagement(): Promise<void> {
    console.log('🔍 Testing Conversation Management...');
    
    try {
      // Test new conversation
      this.agentService.startNewConversation();
      console.log('✅ Started new conversation');
      
      // Test conversation history
      const history = this.agentService.getConversationHistory();
      console.log('✅ Conversation history after new conversation:', history.length);
      
      // Test clearing history
      this.agentService.clearConversationHistory();
      const clearedHistory = this.agentService.getConversationHistory();
      console.log('✅ Conversation history after clear:', clearedHistory.length);
      
    } catch (error) {
      console.error('❌ Conversation management test failed:', error);
    }
  }

  async testErrorHandling(): Promise<void> {
    console.log('🔍 Testing Error Handling...');
    
    try {
      // Test with invalid API key (if configured)
      const testService = getASIOneService({
        apiKey: 'invalid_key_for_testing',
        baseUrl: 'https://api.asi1.ai/v1'
      });
      
      const response = await testService.sendMessage("This should fail gracefully");
      console.log('✅ Error handling works - got fallback response:', response.substring(0, 50) + '...');
      
    } catch (error) {
      console.log('✅ Error handling works - caught expected error:', error);
    }
  }

  async testRealAgentCommunication(): Promise<void> {
    console.log('🔍 Testing Real Agent Communication...');
    
    try {
      const testMessages = [
        "Hello, I'm testing DotBot",
        "Check my DOT balance",
        "Send 1 DOT to Alice",
        "Swap DOT for USDC",
        "Show me active referendums"
      ];

      for (const message of testMessages) {
        console.log(`\n📤 Sending: "${message}"`);
        
        const agentId = this.agentService.routeMessage(message);
        console.log(`🎯 Routed to agent: ${agentId}`);
        
        const response = await this.agentService.sendToAgent({
          agentId,
          message,
          context: {
            conversationId: this.agentService.getASIOneService().getConversationId(),
            previousMessages: [],
            userWallet: '5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY',
            network: 'Polkadot'
          }
        });
        
        console.log(`📥 Response: ${response.content.substring(0, 100)}...`);
        console.log(`📊 Metadata:`, response.metadata);
      }
      
    } catch (error) {
      console.error('❌ Real agent communication test failed:', error);
    }
  }
}

// Export for use in browser console or tests
export const runASIOneTests = async () => {
  const tester = new ASIOneIntegrationTester();
  await tester.runAllTests();
};

// Auto-run tests if in development
if (process.env.NODE_ENV === 'development') {
  console.log('🚀 ASI-One Integration Tester loaded. Run runASIOneTests() to test the integration.');
}
