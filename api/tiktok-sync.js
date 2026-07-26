// Returns follower count and recent video engagement from TikTok.
// See _platformFetchers.js for how the data is retrieved, including the
// mandatory token refresh TikTok requires on every call.

const { setCors } = require('./_util');
const { fetchTikTok } = require('./_platformFetchers');

module.exports = async (req, res) => {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  try{
    const data = await fetchTikTok();
    return res.status(200).json(data);
  }catch(err){
    return res.status(502).json({ error: err.message });
  }
};
