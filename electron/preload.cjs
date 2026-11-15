const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('roundsConfig', Object.freeze({
  supabaseUrl: process.env.ROUNDS_SUPABASE_URL || '',
  supabasePublishableKey: process.env.ROUNDS_SUPABASE_PUBLISHABLE_KEY || ''
}));
