// Returns page follower count and recent post engagement for the connected
// Facebook Page. See _platformFetchers.js for how the data is retrieved.

const { setCors } = require('./_util');
const { fetchFacebook } = require('./_platformFetchers');

module.exports = async (req, res) => {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  try{
    const data = await fetchFacebook();
    return res.status(200).json(data);
  }catch(err){
    return res.status(502).json({ error: err.message });
  }
};
