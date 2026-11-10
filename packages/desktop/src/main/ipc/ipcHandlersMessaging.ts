// IPC handlers for local messaging (see messaging/controller.ts). Errors are
// returned as { error } rather than thrown, so the renderer can show the
// message instead of Electron's generic "Error invoking remote method".

import { ipcMain } from 'electron'

import {
  cancelLogin,
  enableMessaging,
  getLogin,
  getMessagingStatus,
  listIrcNetworks,
  removeAccount,
  setIrcNetwork,
  startLogin,
  submitLogin,
  type IrcNetwork
} from '../messaging/controller'

async function wrap<T>(fn: () => Promise<T>): Promise<T | { error: string }> {
  try {
    return await fn()
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) }
  }
}

export function registerMessagingHandlers(): void {
  ipcMain.handle('messaging:status', () => getMessagingStatus())
  ipcMain.handle('messaging:enable', () => wrap(() => enableMessaging()))
  ipcMain.handle('messaging:startLogin', (_e, network: string, flow?: string) => wrap(() => startLogin(network, flow)))
  ipcMain.handle('messaging:submitLogin', (_e, network: string, id: string, values: Record<string, string>) =>
    wrap(() => submitLogin(network, id, values))
  )
  ipcMain.handle('messaging:getLogin', (_e, network: string, id: string) => wrap(() => getLogin(network, id)))
  ipcMain.handle('messaging:cancelLogin', (_e, network: string, id: string) =>
    wrap(async () => {
      await cancelLogin(network, id)
      return { ok: true }
    })
  )
  ipcMain.handle('messaging:removeAccount', (_e, accountId: string) =>
    wrap(async () => {
      await removeAccount(accountId)
      return { ok: true }
    })
  )
  ipcMain.handle('messaging:listIrcNetworks', () => wrap(() => listIrcNetworks()))
  ipcMain.handle('messaging:setIrcNetwork', (_e, name: string, net: IrcNetwork) =>
    wrap(async () => {
      await setIrcNetwork(name, net)
      return { ok: true }
    })
  )
}
