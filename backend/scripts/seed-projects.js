require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mongoose = require('mongoose');
const User = require('../src/models/User');
const Project = require('../src/models/Project');

async function main() {
  await mongoose.connect(process.env.MONGO_URI);

  await User.updateMany({ role: 'product_manager' }, { $set: { role: 'manager' } });
  await User.updateMany({ role: 'developer' }, { $set: { role: 'manager' } });
  await User.updateMany({ role: 'designer' }, { $set: { role: 'manager' } });
  await User.updateMany({ role: 'admin' }, { $set: { role: 'manager' } });

  const user = await User.findOne({ email: 'vaibhavghawanetest@gmail.com' }).lean();
  if (user) {
    const existing = await Project.findOne({ owner: user._id }).lean();
    if (!existing) {
      await Project.create({
        name: 'DevTrack Workspace',
        key: 'DTRK',
        owner: user._id,
        description: 'Seed project for workspace visibility',
        status: 'active',
      });
    }
  }

  const users = await User.find({}).select('name email role').lean();
  const projects = await Project.find({}).select('name key owner status').lean();

  console.log(JSON.stringify({ users, projects }, null, 2));
  await mongoose.disconnect();
}

main().catch(async (error) => {
  console.error(error);
  try {
    await mongoose.disconnect();
  } catch (_) {}
  process.exit(1);
});
