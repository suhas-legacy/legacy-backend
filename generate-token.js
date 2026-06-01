'use strict';

const { google } = require('googleapis');
const readline = require('readline');
require('dotenv').config();

// Ensure the user understands how to set this up
const clientId = process.env.GOOGLE_CLIENT_ID;
const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
const redirectUri = process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3000/oauth2callback';

if (!clientId || clientId.includes('your-google-client-id') || !clientSecret || clientSecret.includes('your-google-client-secret')) {
  console.error('\n❌ ERROR: Please set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in your .env file first!\n');
  process.exit(1);
}

const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, redirectUri);

const scopes = ['https://www.googleapis.com/auth/calendar'];

const authUrl = oauth2Client.generateAuthUrl({
  access_type: 'offline', // crucial to obtain a refresh token
  prompt: 'consent',     // forces consent screen to display to guarantee refresh token is returned
  scope: scopes,
});

console.log('\n======================================================');
console.log('🔗 STEP 1: OPEN THIS URL IN YOUR WEB BROWSER:');
console.log('======================================================');
console.log(authUrl);
console.log('======================================================\n');
console.log('Sign in with suhas@legacyglobalbank.com or contact@legacyglobalbank.com');
console.log('and click "Allow" on the permission screen.\n');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

rl.question('📋 STEP 2: Paste the redirect URL (or authorization code "?code=...") here:\n> ', async (input) => {
  rl.close();
  try {
    let code = input.trim();
    // Extract code from URL if the user pasted the entire redirect URL
    if (code.includes('code=')) {
      const urlObj = new URL(code);
      code = urlObj.searchParams.get('code');
    }

    if (!code) {
      throw new Error('No authorization code found in your input.');
    }

    console.log('\n⏳ Exchanging authorization code for tokens...');
    const { tokens } = await oauth2Client.getToken(code);

    console.log('\n======================================================');
    console.log('🎉 SUCCESS! TOKENS RECEIVED:');
    console.log('======================================================');
    console.log(JSON.stringify(tokens, null, 2));
    console.log('======================================================\n');

    if (!tokens.refresh_token) {
      console.warn('⚠️  WARNING: No refresh token returned!');
      console.warn('If you have authorized this application before, Google will not send a refresh token');
      console.warn('unless you revoke the app permission in your Google account settings or change your prompt to consent.\n');
    } else {
      console.log('📋 COPY THIS REFRESH TOKEN TO YOUR .env:');
      console.log(`GOOGLE_REFRESH_TOKEN=${tokens.refresh_token}\n`);
    }

  } catch (error) {
    console.error('\n❌ ERROR: Failed to exchange code for tokens:', error.message);
  }
});
