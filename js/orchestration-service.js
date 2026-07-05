(function(global) {
  'use strict';

  const AgentApp = global.AgentApp;
  if (!AgentApp) throw new Error('AgentApp registry must load before orchestration-service.js');

  function moduleFn(moduleName, methodName) {
    const mod = AgentApp.optional(moduleName);
    const fn = mod && mod[methodName];
    return typeof fn === 'function' ? fn : null;
  }

  function globalFn(name) {
    const fn = global[name];
    return typeof fn === 'function' ? fn : null;
  }

  function invoke(candidates, args, label) {
    for (const candidate of candidates) {
      const fn = candidate.module
        ? moduleFn(candidate.module, candidate.method)
        : globalFn(candidate.global);
      if (fn) return fn(...args);
    }
    throw new Error('orchestration function not loaded: ' + label);
  }

  function callAPI(roundLimit, options = {}) {
    return invoke([
      { module: 'apiCore', method: 'callAPI' },
      { global: 'callAPI' }
    ], [roundLimit, options || {}], 'callAPI');
  }

  function callAPIWithPlan(options = {}) {
    return invoke([
      { module: 'planCore', method: 'callAPIWithPlan' },
      { global: 'callAPIWithPlan' }
    ], [options || {}], 'callAPIWithPlan');
  }

  function callAPIWithOutline(options = {}) {
    return invoke([
      { module: 'outlineCore', method: 'callAPIWithOutline' },
      { global: 'callAPIWithOutline' }
    ], [options || {}], 'callAPIWithOutline');
  }

  function callAPIWithPptMode(options = {}) {
    return invoke([
      { module: 'pptMode', method: 'callAPIWithPptMode' },
      { global: 'callAPIWithPptMode' }
    ], [options || {}], 'callAPIWithPptMode');
  }

  function callAPIWithReflection(options = {}) {
    return invoke([
      { module: 'reflection', method: 'callAPIWithReflection' },
      { global: 'callAPIWithReflection' }
    ], [options || {}], 'callAPIWithReflection');
  }

  function executeTool(name, args, context = {}) {
    return invoke([
      { module: 'tools', method: 'executeTool' },
      { global: 'executeTool' }
    ], [name, args, context || {}], 'executeTool');
  }

  function callOnceWithRole(history, model, rolePrompt, options = {}) {
    return invoke([
      { module: 'apiCore', method: 'callOnceWithRole' },
      { global: 'callOnceWithRole' }
    ], [history, model, rolePrompt, options || {}], 'callOnceWithRole');
  }

  function callByMode(mode, options = {}) {
    const selected = mode || 'normal';
    if (selected === 'outline') return callAPIWithOutline(options);
    if (selected === 'plan') return callAPIWithPlan(options);
    if (selected === 'ppt') return callAPIWithPptMode(options);
    if (selected === 'reflection') return callAPIWithReflection(options);

    const { roundLimit, ...apiOptions } = options || {};
    return callAPI(roundLimit, apiOptions);
  }

  AgentApp.define('orchestrationService', {
    callAPI,
    callAPIWithPlan,
    callAPIWithOutline,
    callAPIWithPptMode,
    callAPIWithReflection,
    executeTool,
    callOnceWithRole,
    callByMode
  });
})(window);
