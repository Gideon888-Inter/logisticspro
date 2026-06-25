const { createClient } = require('@supabase/supabase-js');

const supabaseUrl     = process.env.SUPABASE_URL;
const supabaseKey     = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

if (!supabaseUrl)  throw new Error('Missing env var: SUPABASE_URL');
if (!supabaseKey)  throw new Error('Missing env var: SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SERVICE_KEY)');

const supabase = createClient(supabaseUrl, supabaseKey);

module.exports = supabase;
