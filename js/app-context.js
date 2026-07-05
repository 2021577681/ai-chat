(function(global) {
  'use strict';

  const existing = global.AgentApp || {};
  const modules = existing.modules || Object.create(null);

  function define(name, api) {
    if (!name || typeof name !== 'string') {
      throw new Error('AgentApp.define requires a module name');
    }
    if (!api || typeof api !== 'object') {
      throw new Error('AgentApp.define requires an API object');
    }
    modules[name] = api;
    return api;
  }

  function requireModule(name) {
    const api = modules[name];
    if (!api) throw new Error('AgentApp module not found: ' + name);
    return api;
  }

  function optional(name) {
    return modules[name] || null;
  }

  global.AgentApp = {
    ...existing,
    modules,
    define,
    require: requireModule,
    optional
  };
})(window);
