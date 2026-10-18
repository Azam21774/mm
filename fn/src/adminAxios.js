import axios from 'axios';

const ADMIN_API_URL = process.env.NEXT_PUBLIC_ADMIN_API_URL || 'https://mmadmin.savetemplate.com';
const adminAxios = axios.create({ baseURL: ADMIN_API_URL });

export default adminAxios;
