import axios from 'axios';

// Falls back to the production admin host so a build without an env file
// (fn/.env.production is git-ignored) still targets the real server instead
// of sending relative requests to the local Electron server.
const ADMIN_API_URL = 'https://ougnvhvbejiibxtdrdld.supabase.co/functions/v1/license-api';

const adminAxios = axios.create({ baseURL: ADMIN_API_URL });

export default adminAxios;
