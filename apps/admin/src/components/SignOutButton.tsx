import { clearAuth } from '../api/client'

export function SignOutButton() {
  return (
    <button
      type="button"
      onClick={() => {
        clearAuth()
        window.location.href = '/login'
      }}
      className="min-h-touch rounded-md px-3 py-2 text-sm font-medium text-salt-300 transition-colors hover:bg-steel-700 hover:text-salt-50"
    >
      Sign out
    </button>
  )
}
