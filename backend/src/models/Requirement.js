const mongoose = require('mongoose');

const RequirementSchema = new mongoose.Schema(
  {
    project: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Project',
      required: true,
      index: true,
      unique: true,
    },
    document: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Document',
    },
    functional: {
      type: [String],
      default: [],
    },
    nonFunctional: {
      type: [String],
      default: [],
    },
    modules: {
      type: [String],
      default: [],
    },
    actors: {
      type: [String],
      default: [],
    },
    source: {
      type: String,
      default: 'srs_extract',
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Requirement', RequirementSchema);
