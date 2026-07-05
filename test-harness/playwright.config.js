const path = require('path');
const Module = require('module');
const { defineConfig, devices } = require('@playwright/test');

const localNodeModules = path.join(__dirname, 'node_modules');
process.env.NODE_PATH = process.env.NODE_PATH
  ? `${localNodeModules}${path.delimiter}${process.env.NODE_PATH}`
  : localNodeModules;
Module._initPaths();

module.exports = defineConfig({
  testDir: path.join(__dirname, '..', 'tests', 'e2e'),
  outputDir: path.join(__dirname, 'test-results'),
  timeout: 45_000,
  expect: {
    timeout: 8_000
  },
  fullyParallel: false,
  reporter: [['list'], ['html', { open: 'never', outputFolder: path.join(__dirname, 'playwright-report') }]],
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    acceptDownloads: true,
    viewport: { width: 1366, height: 900 }
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] }
    }
  ]
});
