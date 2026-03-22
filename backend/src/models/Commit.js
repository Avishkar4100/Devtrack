const mongoose = require('mongoose');

const CommitSchema = new mongoose.Schema(
  {
    projectId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Project',
      required: true,
      index: true,
    },
    sha: {
      type: String,
      required: true,
      trim: true,
    },
    message: {
      type: String,
      default: '',
    },
    author: {
      type: String,
      default: 'Unknown',
    },
    date: {
      type: Date,
      index: true,
    },
    filesChanged: {
      type: Number,
      default: 0,
    },
  },
  {
    timestamps: true,
  }
);

CommitSchema.index({ projectId: 1, sha: 1 }, { unique: true });

module.exports = mongoose.model('Commit', CommitSchema);
