import { createContext, useContext } from 'react'

/**
 * Account id → nickname, for transaction lists that mix accounts. Provided
 * once by the expenses module, so every drill-down can say which account a
 * row is on without threading the accounts through each one.
 */
export const AccountNamesContext = createContext<((accountId: string) => string) | undefined>(undefined)

export const useAccountName = () => useContext(AccountNamesContext)
