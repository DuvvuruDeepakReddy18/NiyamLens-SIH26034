import { adminClient, uuid } from '../server/security.mjs'
const args = Object.fromEntries(process.argv.slice(2).map((arg) => { const index = arg.indexOf('='); return [arg.slice(0, index), arg.slice(index + 1)] }))
if (!args['--user-id'] || (!args['--org-name'] && !args['--org-id'])) {
  console.log('Provision an existing Auth user. No passwords or email invitations are created by this script.\nFirst admin: npm run workspace:setup -- --org-name="NiyamLens team" --user-id=AUTH_USER_UUID --role=admin\nAdd member: npm run workspace:setup -- --org-id=WORKSPACE_UUID --user-id=AUTH_USER_UUID --role=officer\nRequires server credentials in .env.local. Obtain user UUIDs from your own Supabase Auth dashboard.'); process.exit(0)
}
if (!uuid(args['--user-id']) || (args['--org-id'] && !uuid(args['--org-id']))) throw new Error('Use valid UUIDs, not email addresses or credentials.')
const role = args['--role'] || 'officer'
if (!['officer', 'supervisor', 'admin'].includes(role)) throw new Error('Invalid role.')
const client = adminClient()
const { data: user, error: userError } = await client.auth.admin.getUserById(args['--user-id'])
if (userError || !user.user) throw new Error('Auth user does not exist in this project.')
let org = args['--org-id']
if (!org) {
  const name = args['--org-name'].trim()
  if (!name || name.length > 120 || role !== 'admin') throw new Error('A new workspace needs a name and its first admin.')
  const { data: existing, error: lookupError } = await client.from('organizations').select('id').eq('name', name)
  if (lookupError) throw lookupError
  if (existing.length) throw new Error('A workspace with this name exists. Use --org-id to avoid a duplicate.')
  const { data, error } = await client.from('organizations').insert({ name }).select('id').single()
  if (error) throw error
  org = data.id
  console.log(`Created workspace ${org}. If membership creation fails, retry using --org-id=${org}.`)
}
const { data: existing, error: membershipError } = await client.from('memberships').select('role,active').eq('org_id', org).eq('user_id', user.user.id).maybeSingle()
if (membershipError) throw membershipError
if (existing) throw new Error('Membership already exists. Review role or suspension changes explicitly in the administrator dashboard; this setup command will not overwrite it.')
const { error } = await client.from('memberships').insert({ org_id: org, user_id: user.user.id, role, display_name: args['--name'] || user.user.email })
if (error) throw error
console.log(`Provisioned ${role} membership in workspace ${org}. No secret keys were printed.`)
