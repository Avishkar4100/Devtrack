import { useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import {
  UserCircleIcon, KeyIcon, CodeBracketIcon, LinkIcon,
  CheckCircleIcon, XCircleIcon, EyeIcon, EyeSlashIcon,
  ShieldCheckIcon, CogIcon, SparklesIcon,
} from '@heroicons/react/24/outline'
import api from '@/lib/api'
import { useAuthStore } from '@/store/authStore'
import toast from 'react-hot-toast'
import { motion, AnimatePresence } from 'framer-motion'

/* ── Jira Projects List Component ── */
function JiraProjectsList({ userEmail, jiraDomain }) {
  const { data: connectedProjects = [], isLoading } = useQuery({
    queryKey: ['jira-connected-projects', userEmail, jiraDomain],
    queryFn: async () => {
      if (!userEmail || !jiraDomain) return []
      try {
        const { data } = await api.get('/projects?jiraConnected=true')
        return data.data || []
      } catch (error) {
        console.error('Failed to fetch Jira-connected projects:', error)
        return []
      }
    },
    enabled: Boolean(userEmail && jiraDomain),
    staleTime: 1000 * 60 * 5, // 5 minutes
  })

  if (isLoading) {
    return <div style={{ fontSize:'12px', color:'var(--text-muted)' }}>Loading projects...</div>
  }

  if (connectedProjects.length === 0) {
    return <div style={{ fontSize:'12px', color:'var(--text-muted)' }}>No projects connected to Jira yet. Create a project and enable Jira sync in settings.</div>
  }

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:'8px' }}>
      {connectedProjects.map((project) => (
        <div key={project._id} style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'8px 0', borderTop:'1px solid var(--border-card)' }}>
          <div>
            <p style={{ fontSize:'12px', fontWeight:600, color:'var(--text-primary)' }}>{project.name}</p>
            {project.jiraProjectKey && (
              <p style={{ fontSize:'11px', color:'var(--text-muted)' }}>
                Jira Key: <span style={{ fontFamily:'monospace', color:'#0052CC', fontWeight:600 }}>{project.jiraProjectKey}</span>
              </p>
            )}
          </div>
          <div style={{ fontSize:'10px', fontWeight:600, color:'#0052CC', background:'rgba(0,82,204,0.15)', padding:'3px 8px', borderRadius:'4px' }}>
            ✓ Synced
          </div>
        </div>
      ))}
    </div>
  )
}

/* ── Animated Section Card ── */
function Section({ icon: Icon, title, description, accent = '#6366f1', iconBg, children, index = 0 }) {
  return (
    <motion.div
      initial={{ opacity:0, y:24 }} animate={{ opacity:1, y:0 }}
      transition={{ delay:index*0.08, duration:0.55, ease:[0.16,1,0.3,1] }}
      style={{ background:'var(--bg-card)', border:'1px solid var(--border-card)', borderRadius:'18px', overflow:'hidden', boxShadow:'var(--shadow-card)', position:'relative' }}>

      {/* Top accent bar */}
      <div style={{ position:'absolute', top:0, left:0, right:0, height:'2px', background:`linear-gradient(90deg, ${accent}, ${accent}88, transparent)`, pointerEvents:'none' }} />

      <div style={{ padding:'24px 24px 20px' }}>
        {/* Header */}
        <div style={{ display:'flex', alignItems:'flex-start', gap:'14px', marginBottom:'22px' }}>
          <motion.div style={{ width:'44px', height:'44px', borderRadius:'13px', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0, background: iconBg || `linear-gradient(135deg, ${accent}30, ${accent}18)`, border:`1px solid ${accent}30`, boxShadow:`0 4px 14px ${accent}22` }}
            whileHover={{ scale:1.08, boxShadow:`0 6px 24px ${accent}40` }}
            transition={{ type:'spring', stiffness:400 }}>
            <Icon style={{ width:'20px', height:'20px', color:accent }} />
          </motion.div>
          <div style={{ flex:1 }}>
            <h3 style={{ fontSize:'15px', fontWeight:700, color:'var(--text-primary)', marginBottom:'3px', letterSpacing:'-0.02em' }}>{title}</h3>
            <p style={{ fontSize:'12px', color:'var(--text-muted)', lineHeight:1.5 }}>{description}</p>
          </div>
        </div>
        {children}
      </div>
    </motion.div>
  )
}

function Field({ label, hint, children }) {
  return (
    <div style={{ display:'flex', flexDirection:'column', gap:'6px' }}>
      <label style={{ fontSize:'12px', fontWeight:600, color:'var(--text-secondary)', letterSpacing:'0.01em' }}>{label}</label>
      {children}
      {hint && <p style={{ fontSize:'11px', color:'var(--text-muted)' }}>{hint}</p>}
    </div>
  )
}

function SecretInput({ value, onChange, placeholder, name }) {
  const [show, setShow] = useState(false)
  return (
    <div style={{ position:'relative' }}>
      <input type={show ? 'text' : 'password'} value={value} onChange={onChange} name={name} placeholder={placeholder} className="input pr-10" />
      <button type="button" onClick={() => setShow(!show)}
        style={{ position:'absolute', right:'12px', top:'50%', transform:'translateY(-50%)', background:'none', border:'none', cursor:'pointer', color:'var(--text-muted)', display:'flex' }}>
        {show ? <EyeSlashIcon style={{ width:'14px', height:'14px' }} /> : <EyeIcon style={{ width:'14px', height:'14px' }} />}
      </button>
    </div>
  )
}

function StatusChip({ status }) {
  const cfg = {
    success: { bg:'rgba(16,185,129,0.14)', border:'rgba(16,185,129,0.35)', color:'#34d399', icon:<CheckCircleIcon style={{ width:'14px', height:'14px' }} />, label:'Connected' },
    error:   { bg:'rgba(239,68,68,0.14)',  border:'rgba(239,68,68,0.35)',  color:'#f87171', icon:<XCircleIcon   style={{ width:'14px', height:'14px' }} />, label:'Failed' },
    default: { bg:'var(--bg-hover)',        border:'var(--border-card)',     color:'var(--text-muted)', icon:<LinkIcon style={{ width:'14px', height:'14px' }} />, label:'Configured' },
  }
  const c = cfg[status] || cfg.default
  return (
    <div style={{ display:'inline-flex', alignItems:'center', gap:'6px', padding:'6px 12px', borderRadius:'9px', background:c.bg, border:`1px solid ${c.border}`, color:c.color, fontSize:'12px', fontWeight:600 }}>
      {c.icon}{c.label}
    </div>
  )
}

export default function SettingsPage() {
  const { user, updateUser } = useAuthStore()
  const [profile, setProfile] = useState({ name: user?.name || '' })
  const [jira, setJira] = useState({ jiraEmail: user?.jiraEmail || '', jiraDomain: user?.jiraDomain || '', jiraApiToken: '' })
  const [github, setGithub] = useState({ githubToken: '', githubUsername: user?.githubUsername || '' })
  const [jiraTestStatus, setJiraTestStatus] = useState(null)
  const [jiraConnectedUser, setJiraConnectedUser] = useState(null)
  const [activeTab, setActiveTab] = useState('profile')

  const profileMutation = useMutation({
    mutationFn: (body) => api.put('/auth/profile', body),
    onSuccess: ({ data }) => { updateUser(data.data); toast.success('Profile updated!') },
  })

  const integrationsMutation = useMutation({
    mutationFn: (body) => api.put('/auth/integrations', body),
    onSuccess: ({ data }) => { updateUser(data.data); toast.success('Integration saved!') },
  })

  const testJiraMutation = useMutation({
    mutationFn: () => api.get('/jira/test'),
    onSuccess: ({ data }) => { 
      setJiraTestStatus('success')
      setJiraConnectedUser(data.data)
      toast.success(`Jira connected as ${data.data?.displayName || 'unknown user'}`) 
    },
    onError: () => { setJiraTestStatus('error'); setJiraConnectedUser(null); toast.error('Jira connection failed. Check credentials.') },
  })

  const handleSaveJira = (e) => {
    e.preventDefault()
    const payload = { jiraEmail: jira.jiraEmail, jiraDomain: jira.jiraDomain }
    if (jira.jiraApiToken) payload.jiraApiToken = jira.jiraApiToken
    integrationsMutation.mutate(payload)
  }
  const handleSaveGitHub = (e) => {
    e.preventDefault()
    const payload = { githubUsername: github.githubUsername }
    if (github.githubToken) payload.githubToken = github.githubToken
    integrationsMutation.mutate(payload)
  }

  const tabs = [
    { id:'profile',  label:'Profile',  icon:<UserCircleIcon style={{ width:'15px', height:'15px' }} /> },
    { id:'jira',     label:'Jira',     icon:<LinkIcon       style={{ width:'15px', height:'15px' }} /> },
    { id:'github',   label:'GitHub',   icon:<CodeBracketIcon style={{ width:'15px', height:'15px' }} /> },
    { id:'security', label:'Security', icon:<ShieldCheckIcon style={{ width:'15px', height:'15px' }} /> },
  ]

  return (
    <div style={{ padding:'32px', maxWidth:'860px', margin:'0 auto' }}>

      {/* Page header */}
      <motion.div initial={{ opacity:0, y:-16 }} animate={{ opacity:1, y:0 }}
        transition={{ duration:0.5, ease:[0.16,1,0.3,1] }}
        style={{ marginBottom:'32px' }}>
        <div style={{ display:'flex', alignItems:'center', gap:'12px', marginBottom:'6px' }}>
          <motion.div style={{ width:'40px', height:'40px', borderRadius:'12px', display:'flex', alignItems:'center', justifyContent:'center', background:'linear-gradient(135deg,rgba(99,102,241,0.2),rgba(139,92,246,0.15))', border:'1px solid rgba(99,102,241,0.2)' }}
            animate={{ boxShadow:['0 0 0px rgba(99,102,241,0)','0 0 20px rgba(99,102,241,0.25)','0 0 0px rgba(99,102,241,0)'] }}
            transition={{ duration:3, repeat:Infinity, ease:'easeInOut' }}>
            <CogIcon style={{ width:'20px', height:'20px', color:'#818cf8' }} />
          </motion.div>
          <div>
            <h1 style={{ fontSize:'22px', fontWeight:900, color:'var(--text-primary)', letterSpacing:'-0.04em', lineHeight:1 }}>Settings</h1>
            <p style={{ fontSize:'13px', color:'var(--text-muted)', marginTop:'3px' }}>Manage your profile, integrations and security</p>
          </div>
        </div>
      </motion.div>

      {/* Tab pills */}
      <motion.div initial={{ opacity:0, y:10 }} animate={{ opacity:1, y:0 }} transition={{ delay:0.1, duration:0.4 }}
        style={{ display:'flex', gap:'6px', marginBottom:'28px', padding:'5px', background:'var(--bg-card)', border:'1px solid var(--border-card)', borderRadius:'14px', width:'fit-content' }}>
        {tabs.map((t) => (
          <motion.button key={t.id} onClick={() => setActiveTab(t.id)}
            whileHover={{ scale: activeTab === t.id ? 1 : 1.04 }} whileTap={{ scale:0.97 }}
            style={{ display:'flex', alignItems:'center', gap:'6px', padding:'7px 14px', borderRadius:'10px', fontSize:'13px', fontWeight:600, cursor:'pointer', border:'none', transition:'all 0.18s',
              background: activeTab === t.id ? 'linear-gradient(135deg,#6366f1,#8b5cf6)' : 'transparent',
              color: activeTab === t.id ? 'white' : 'var(--text-muted)',
              boxShadow: activeTab === t.id ? '0 4px 14px rgba(99,102,241,0.35)' : 'none',
            }}>
            {t.icon}{t.label}
          </motion.button>
        ))}
      </motion.div>

      {/* Tab content */}
      <AnimatePresence mode="wait">
        <motion.div key={activeTab}
          initial={{ opacity:0, y:12 }} animate={{ opacity:1, y:0 }} exit={{ opacity:0, y:-8 }}
          transition={{ duration:0.3, ease:[0.16,1,0.3,1] }}
          style={{ display:'flex', flexDirection:'column', gap:'20px' }}>

          {activeTab === 'profile' && (
            <Section icon={UserCircleIcon} title="Profile" description="Update your display name and account details" accent="#6366f1" index={0}>
              <form onSubmit={(e) => { e.preventDefault(); profileMutation.mutate(profile) }} style={{ display:'flex', flexDirection:'column', gap:'14px' }}>
                <Field label="Full Name">
                  <input type="text" value={profile.name} onChange={e => setProfile({ ...profile, name:e.target.value })} className="input" placeholder="Your name" />
                </Field>
                <Field label="Email Address" hint="Email cannot be changed">
                  <input type="email" value={user?.email || ''} className="input" style={{ opacity:0.5, cursor:'not-allowed' }} disabled />
                </Field>
                <Field label="Role" hint="Role is assigned by your project admin">
                  <input type="text" value={user?.role?.replace('_',' ').replace(/\b\w/g, c=>c.toUpperCase()) || ''} className="input" style={{ opacity:0.5, cursor:'not-allowed' }} disabled />
                </Field>

                {/* Avatar preview */}
                <div style={{ display:'flex', alignItems:'center', gap:'14px', padding:'14px 16px', borderRadius:'12px', background:'var(--bg-hover)', border:'1px solid var(--border-card)' }}>
                  <div style={{ width:'48px', height:'48px', borderRadius:'50%', background:'linear-gradient(135deg,#4f46e5,#7c3aed)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:'18px', fontWeight:800, color:'white', boxShadow:'0 4px 14px rgba(99,102,241,0.4)' }}>
                    {user?.name?.[0]?.toUpperCase()}
                  </div>
                  <div>
                    <p style={{ fontSize:'14px', fontWeight:600, color:'var(--text-primary)' }}>{user?.name}</p>
                    <p style={{ fontSize:'12px', color:'var(--text-muted)' }}>{user?.email}</p>
                  </div>
                </div>

                <div style={{ display:'flex', justifyContent:'flex-end' }}>
                  <motion.button type="submit" disabled={profileMutation.isPending} className="btn-primary"
                    whileHover={{ scale:1.03 }} whileTap={{ scale:0.97 }}>
                    {profileMutation.isPending ? 'Saving…' : 'Save Profile'}
                  </motion.button>
                </div>
              </form>
            </Section>
          )}

          {activeTab === 'jira' && (
            <Section icon={LinkIcon} title="Jira Integration" description="Connect your Atlassian account to push stories and epics to Jira" accent="#0052CC" iconBg="linear-gradient(135deg,rgba(0,82,204,0.2),rgba(0,82,204,0.1))" index={0}>
              <form onSubmit={handleSaveJira} style={{ display:'flex', flexDirection:'column', gap:'14px' }}>
                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'12px' }}>
                  <Field label="Jira Email" hint="Your Atlassian account email">
                    <input type="email" value={jira.jiraEmail} onChange={e => setJira({ ...jira, jiraEmail:e.target.value })} className="input" placeholder="you@company.com" />
                  </Field>
                  <Field label="Jira Domain" hint="e.g. mycompany.atlassian.net">
                    <input type="text" value={jira.jiraDomain} onChange={e => setJira({ ...jira, jiraDomain:e.target.value })} className="input" placeholder="mycompany.atlassian.net" />
                  </Field>
                </div>
                <Field label="Jira API Token" hint="Generate at id.atlassian.com → Security → API tokens. Leave blank to keep existing.">
                  <SecretInput value={jira.jiraApiToken} onChange={e => setJira({ ...jira, jiraApiToken:e.target.value })} placeholder="Enter new API token..." name="jiraApiToken" />
                </Field>
                
                {/* Connected Jira User Info */}
                {jiraConnectedUser && (
                  <div style={{ display:'flex', alignItems:'center', gap:'12px', padding:'12px 14px', borderRadius:'12px', background:'rgba(0,82,204,0.08)', border:'1px solid rgba(0,82,204,0.2)' }}>
                    {jiraConnectedUser.avatarUrls?.['24x24'] && (
                      <img src={jiraConnectedUser.avatarUrls['24x24']} alt={jiraConnectedUser.displayName} style={{ width:'32px', height:'32px', borderRadius:'50%' }} />
                    )}
                    <div style={{ flex:1 }}>
                      <p style={{ fontSize:'13px', fontWeight:600, color:'#0052CC' }}>{jiraConnectedUser.displayName}</p>
                      <p style={{ fontSize:'12px', color:'var(--text-muted)' }}>{jiraConnectedUser.emailAddress}</p>
                    </div>
                    <div style={{ fontSize:'11px', color:'#0052CC', fontWeight:600, background:'rgba(0,82,204,0.15)', padding:'4px 8px', borderRadius:'6px' }}>✓ Connected</div>
                  </div>
                )}
                
                {(user?.jiraEmail || jiraTestStatus) && !jiraConnectedUser && (
                  <div style={{ display:'flex', alignItems:'center', gap:'8px' }}>
                    <StatusChip status={jiraTestStatus || 'default'} />
                    {!jiraTestStatus && user?.jiraDomain && <span style={{ fontSize:'12px', color:'var(--text-muted)' }}>for {user.jiraDomain}</span>}
                  </div>
                )}
                
                <div style={{ display:'flex', justifyContent:'flex-end', gap:'10px' }}>
                  <motion.button type="button" onClick={() => testJiraMutation.mutate()} disabled={testJiraMutation.isPending || !jira.jiraEmail} className="btn-secondary"
                    whileHover={{ scale:1.03 }} whileTap={{ scale:0.97 }}>
                    {testJiraMutation.isPending ? 'Testing…' : 'Test Connection'}
                  </motion.button>
                  <motion.button type="submit" disabled={integrationsMutation.isPending} className="btn-primary"
                    whileHover={{ scale:1.03 }} whileTap={{ scale:0.97 }}>
                    {integrationsMutation.isPending ? 'Saving…' : 'Save Jira'}
                  </motion.button>
                </div>
              </form>
              
              {/* Connected Projects Section */}
              {user?.jiraEmail && (
                <div style={{ marginTop:'24px', padding:'14px', borderRadius:'12px', background:'var(--bg-hover)', border:'1px solid var(--border-card)' }}>
                  <p style={{ fontSize:'13px', fontWeight:600, color:'var(--text-primary)', marginBottom:'10px' }}>Projects Connected to Jira</p>
                  <p style={{ fontSize:'12px', color:'var(--text-muted)', marginBottom:'10px' }}>These projects are linked to Jira for story synchronization</p>
                  <JiraProjectsList userEmail={user.jiraEmail} jiraDomain={user.jiraDomain} />
                </div>
              )}
            </Section>
          )}

          {activeTab === 'github' && (
            <Section icon={CodeBracketIcon} title="GitHub Integration" description="Connect GitHub to analyze commits against user story acceptance criteria" accent="#6e40c9" index={0}>
              <form onSubmit={handleSaveGitHub} style={{ display:'flex', flexDirection:'column', gap:'14px' }}>
                <Field label="GitHub Username" hint="Your GitHub username">
                  <input type="text" value={github.githubUsername} onChange={e => setGithub({ ...github, githubUsername:e.target.value })} className="input" placeholder="octocat" />
                </Field>
                <Field label="Personal Access Token" hint="Needs repo and read:user scopes. Leave blank to keep existing.">
                  <SecretInput value={github.githubToken} onChange={e => setGithub({ ...github, githubToken:e.target.value })} placeholder="ghp_..." name="githubToken" />
                </Field>
                {user?.githubUsername && (
                  <div style={{ display:'flex', alignItems:'center', gap:'8px' }}>
                    <StatusChip status="success" />
                    <span style={{ fontSize:'12px', color:'var(--text-muted)' }}>Connected as @{user.githubUsername}</span>
                  </div>
                )}
                <div style={{ display:'flex', justifyContent:'flex-end' }}>
                  <motion.button type="submit" disabled={integrationsMutation.isPending} className="btn-primary"
                    whileHover={{ scale:1.03 }} whileTap={{ scale:0.97 }}>
                    {integrationsMutation.isPending ? 'Saving…' : 'Save GitHub'}
                  </motion.button>
                </div>
              </form>
            </Section>
          )}

          {activeTab === 'security' && (
            <Section icon={ShieldCheckIcon} title="Security" description="Manage your password and access security settings" accent="#10b981" iconBg="linear-gradient(135deg,rgba(16,185,129,0.2),rgba(16,185,129,0.1))" index={0}>
              <ChangePasswordForm />
            </Section>
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  )
}

function ChangePasswordForm() {
  const [form, setForm] = useState({ newPassword:'', confirmPassword:'' })
  const mutation = useMutation({
    mutationFn: (body) => api.put('/auth/profile', body),
    onSuccess: () => { toast.success('Password changed!'); setForm({ newPassword:'', confirmPassword:'' }) },
    onError: (err) => toast.error(err.response?.data?.message || 'Failed to change password'),
  })
  const handleSubmit = (e) => {
    e.preventDefault()
    if (form.newPassword !== form.confirmPassword) { toast.error('Passwords do not match'); return }
    if (form.newPassword.length < 6) { toast.error('Password must be at least 6 characters'); return }
    mutation.mutate({ password: form.newPassword })
  }
  return (
    <form onSubmit={handleSubmit} style={{ display:'flex', flexDirection:'column', gap:'14px' }}>
      <Field label="New Password">
        <SecretInput value={form.newPassword} onChange={e => setForm({ ...form, newPassword:e.target.value })} placeholder="New password (min 6 chars)" />
      </Field>
      <Field label="Confirm New Password">
        <SecretInput value={form.confirmPassword} onChange={e => setForm({ ...form, confirmPassword:e.target.value })} placeholder="Repeat new password" />
      </Field>
      <div style={{ padding:'12px 16px', borderRadius:'12px', background:'rgba(16,185,129,0.08)', border:'1px solid rgba(16,185,129,0.2)', fontSize:'12px', color:'#34d399', display:'flex', gap:'8px', alignItems:'flex-start' }}>
        <ShieldCheckIcon style={{ width:'14px', height:'14px', marginTop:'1px', flexShrink:0 }} />
        <span>Use a strong password with at least 6 characters, mixing letters and numbers.</span>
      </div>
      <div style={{ display:'flex', justifyContent:'flex-end' }}>
        <motion.button type="submit" disabled={mutation.isPending || !form.newPassword} className="btn-primary"
          whileHover={{ scale:1.03 }} whileTap={{ scale:0.97 }}>
          {mutation.isPending ? 'Changing…' : 'Change Password'}
        </motion.button>
      </div>
    </form>
  )
}
