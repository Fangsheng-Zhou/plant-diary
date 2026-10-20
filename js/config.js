// Connection settings. The publishable key is designed to be public:
// it only lets the app talk to the database, and the database rules
// (see supabase/setup.sql) decide what each signed-in person can reach.
// Never put a "service_role" or "secret" key here.

export const SUPABASE_URL = 'https://eqfyaeyyiockapusiatn.supabase.co';
export const SUPABASE_KEY = 'sb_publishable_iMbvvdV-VzVkCk-hBvr7SA_6qPySF4H';
export const SUPABASE_DASHBOARD = 'https://supabase.com/dashboard/project/eqfyaeyyiockapusiatn';

export const APP_NAME = 'Plant Diary';
export const APP_VERSION = '1.1.2';
export const SOURCE_URL = 'https://github.com/Fangsheng-Zhou/plant-diary';
