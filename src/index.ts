#!/usr/bin/env node

import { run } from '@oclif/core';

run()
  .then(() => {
    // CLI completed successfully
  })
  .catch(require('@oclif/core/handle'));
