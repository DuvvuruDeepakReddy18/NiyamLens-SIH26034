import { adminClient, reply } from '../server/security.mjs'
export default async function handler(req,res) {
  if(req.method!=='GET') return reply(res,405,{error:'Method not allowed.'})
  try {
    const { error } = await adminClient().from('organizations').select('id').limit(1)
    return reply(res,error?503:200,{service:'niyamlens',ready:!error})
  } catch { return reply(res,503,{service:'niyamlens',ready:false}) }
}
