const chat = jest.fn().mockImplementation(async (messages, options) => {
  const lastMsg = messages[messages.length - 1]?.content || '';
  let responseText = '';
  
  if (lastMsg.includes('vintage 7 fold')) {
    responseText = 'Avenged Sevenfold';
  } else if (lastMsg.includes('toppy guns n roses')) {
    responseText = 'toque guns n roses';
  } else if (lastMsg.includes('skip')) {
    responseText = 'pula';
  } else if (lastMsg.includes('stop')) {
    responseText = 'parar';
  } else if (lastMsg.includes('volume fifty')) {
    responseText = 'volume 50';
  } else {
    responseText = 'mock-ai-response';
  }
  
  return {
    choices: [
      {
        message: {
          content: responseText
        }
      }
    ]
  };
});

module.exports = {
  chat,
  getCurrentProvider: jest.fn().mockReturnValue('MockProvider'),
  getSystemPrompt: jest.fn().mockReturnValue('MockSystemPrompt'),
  getTaskPrompt: jest.fn().mockImplementation((promptId, context) => ({ role: 'system', content: 'MockTaskPrompt' })),
  estimateTokens: jest.fn().mockReturnValue(0),
  logTokenUsage: jest.fn(),
  isComplexQuestion: jest.fn().mockReturnValue(false),
  isSpamOrIrrelevant: jest.fn().mockReturnValue(false),
  requiresDetailedResponse: jest.fn().mockReturnValue(false),
  getEmbedding: jest.fn().mockResolvedValue([0.1, 0.2, 0.3]),
  classifyRelevanceOllama: jest.fn().mockResolvedValue('RELEVANT'),
  shouldRespondToContext: jest.fn().mockResolvedValue(true),
  transcribeAudio: jest.fn().mockResolvedValue('mock transcribed text'),
  detectEmotionalTone: jest.fn().mockReturnValue('neutral'),
  getResponseStyleForTone: jest.fn().mockReturnValue('neutral style')
};
