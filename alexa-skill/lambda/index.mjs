/**
 * Alexa Skill Lambda Handler
 * 
 * Forwards Alexa requests to the home assistant's Alexa webhook endpoint.
 * Deploy this as an AWS Lambda function and link it to your Alexa skill.
 *
 * Environment variables:
 *   HOME_ASSISTANT_URL - URL of your home assistant's Alexa webhook
 *                        (e.g., https://your-domain:3002/alexa)
 */

const HOME_ASSISTANT_URL = process.env.HOME_ASSISTANT_URL;

export const handler = async (event) => {
  // If no forwarding URL, handle locally as a simple proxy
  if (!HOME_ASSISTANT_URL) {
    return buildResponse('Home assistant endpoint not configured.', true);
  }

  try {
    const response = await fetch(HOME_ASSISTANT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(event),
      signal: AbortSignal.timeout(25000), // Alexa has ~30s timeout
    });

    if (!response.ok) {
      console.error(`Home assistant returned ${response.status}`);
      return buildResponse('Sorry, the home assistant is not responding right now.', true);
    }

    return await response.json();
  } catch (err) {
    console.error('Error forwarding to home assistant:', err.message);
    return buildResponse('Sorry, I could not reach the home assistant. Please try again.', true);
  }
};

function buildResponse(text, shouldEndSession) {
  return {
    version: '1.0',
    response: {
      outputSpeech: {
        type: 'PlainText',
        text,
      },
      shouldEndSession,
    },
  };
}
