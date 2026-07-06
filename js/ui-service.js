(function(global) {
  'use strict';

  const AgentApp = global.AgentApp;
  if (!AgentApp) throw new Error('AgentApp registry must load before ui-service.js');

  function globalFn(name) {
    const fn = global[name];
    return typeof fn === 'function' ? fn : null;
  }

  function call(name, args = []) {
    const fn = globalFn(name);
    if (!fn) return undefined;
    return fn(...args);
  }

  const uiService = {
    has(name) {
      return !!globalFn(name);
    },
    call,
    toast(message, ms) {
      return call('toast', [message, ms]);
    },
    renderMessages() {
      return call('renderMessages');
    },
    refreshMsgNode(idx, chat) {
      return call('refreshMsgNode', [idx, chat]);
    },
    appendMsgNode(idx, chat) {
      return call('appendMsgNode', [idx, chat]);
    },
    renderChatList() {
      return call('renderChatList');
    },
    updateSendBtn() {
      return call('updateSendBtn');
    },
    scrollBottom() {
      return call('scrollBottom');
    },
    scrollToBottom() {
      return call('scrollBottom');
    },
    renderPendingAttachments() {
      return call('renderPendingAtts');
    },
    renderTracePanel() {
      return call('renderTracePanel');
    }
  };

  AgentApp.define('uiService', uiService);
})(window);
