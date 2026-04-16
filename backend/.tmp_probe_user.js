require('dotenv').config({ path: './.env' });
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');

(async () => {
  await mongoose.connect(process.env.MONGO_URI);
  const db = mongoose.connection.db;

  const users = await db.collection('users').find({ role: { $ne: 'admin' } }).sort({ createdAt: -1 }).limit(1).toArray();
  const user = users[0];
  if (!user) {
    console.log('NO_USER');
    await mongoose.disconnect();
    return;
  }

  const projects = await db.collection('projects').find({ owner: user._id }).sort({ createdAt: -1 }).limit(1).toArray();
  const project = projects[0] || null;

  const token = jwt.sign({ id: String(user._id) }, process.env.JWT_SECRET, { expiresIn: '2h' });
  console.log(JSON.stringify({
    userId: String(user._id),
    email: user.email,
    projectId: project ? String(project._id) : null,
    token,
  }, null, 2));

  await mongoose.disconnect();
})().catch(async (e) => {
  console.error(e);
  try { await mongoose.disconnect(); } catch (_) {}
  process.exit(1);
});
