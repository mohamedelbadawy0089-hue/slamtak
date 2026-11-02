const https = require('https')
function rawGet(path) {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: 'iksjhjxwphmvthryfeae.supabase.co', port: 443, method: 'GET',
      path,
      headers: {
        'apikey': process.env.SUPABASE_SERVICE_ROLE_KEY,
        'authorization': 'Bearer ' + process.env.SUPABASE_SERVICE_ROLE_KEY,
        'content-type': 'application/json'
      }
    }
    const req = https.request(opts, res => {
      let body = ''
      res.on('data', c => body += c)
      res.on('end', () => {
        try { resolve(JSON.parse(body)) } catch (e) { resolve(body) }
      })
    })
    req.on('error', reject)
    req.end()
  })
}
module.exports = { rawGet }
