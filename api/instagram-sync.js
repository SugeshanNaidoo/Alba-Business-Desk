// Returns follower count, recent posts, and mentions for the connected
// Instagram Business account. See _platformFetchers.js for how the data
// is actually retrieved (via a stored OAuth connection, or env vars).

const { setCors } = require('./_util');
const { fetchInstagram } = require('./_platformFetchers');

module.exports = async (req, res) => {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  try{
    const data = await fetchInstagram();
    return res.status(200).json(data);
  }catch(err){
    return res.status(502).json({ error: err.message });
  }
};
