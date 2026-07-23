import { useEffect, useState } from 'react';
import type { Account, Category, FuelEntry, RecurringRule, RuleSuggestion, Transaction, Vehicle } from '@wallet/shared';
import { useAccounts, useCategories, useMe, useRunAutoPost } from './api';
import { monthLabel, shiftMonth, thisMonth } from './format';
import { Dashboard } from './components/Dashboard';
import { Transactions } from './components/Transactions';
import { Manage } from './components/Manage';
import { Car } from './components/Car';
import { Plan } from './components/Plan';
import { Modal } from './components/Modal';
import { TransactionForm } from './components/TransactionForm';
import { AccountForm } from './components/AccountForm';
import { TransferForm } from './components/TransferForm';
import { CategoryForm } from './components/CategoryForm';
import { VehicleForm } from './components/VehicleForm';
import { FuelForm } from './components/FuelForm';
import { RecurringForm } from './components/RecurringForm';

type Tab = 'dashboard' | 'transactions' | 'car' | 'plan' | 'manage';
type ModalState =
  | { kind: 'tx'; tx?: Transaction }
  | { kind: 'account'; account?: Account }
  | { kind: 'transfer' }
  | { kind: 'category'; category?: Category }
  | { kind: 'vehicle'; vehicle?: Vehicle }
  | { kind: 'fuel'; vehicleId: number; entry?: FuelEntry }
  | { kind: 'recurring'; rule?: RecurringRule; suggestion?: RuleSuggestion }
  | null;

export function App() {
  const [tab, setTab] = useState<Tab>('dashboard');
  const [month, setMonth] = useState(thisMonth());
  const [modal, setModal] = useState<ModalState>(null);

  const me = useMe();
  const accounts = useAccounts();
  const categories = useCategories();
  const close = () => setModal(null);

  // Catch up any due auto-post rules once, on app open (idempotent server-side).
  const runAutoPost = useRunAutoPost();
  const { isSuccess: meReady } = me;
  const { mutate: catchUp } = runAutoPost;
  useEffect(() => {
    if (meReady) catchUp();
  }, [meReady, catchUp]);

  // Add-transaction needs an account; if none, send the user to create one first.
  const noAccounts = (accounts.data?.length ?? 0) === 0;
  const onFab = () => setModal(noAccounts ? { kind: 'account' } : { kind: 'tx' });

  if (me.isError) {
    return (
      <main className="mx-auto max-w-md p-8 text-center">
        <h1 className="mb-2 text-xl font-semibold">Wallet</h1>
        <p className="text-slate-500">Not signed in. This app expects your reverse proxy (Authelia) to provide your identity.</p>
      </main>
    );
  }

  // Only the month-scoped tabs; Car and Manage ignore the month.
  const showMonthNav = tab === 'dashboard' || tab === 'transactions';

  return (
    <div className="min-h-dvh bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <header className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-200 bg-slate-50/90 px-4 py-3 backdrop-blur dark:border-slate-800 dark:bg-slate-950/90">
        <h1 className="text-lg font-bold">Wallet</h1>
        {showMonthNav && (
          <div className="flex items-center gap-2">
            <button aria-label="Previous month" className="px-2 text-slate-400 hover:text-slate-600" onClick={() => setMonth((m) => shiftMonth(m, -1))}>‹</button>
            <span className="w-32 text-center text-sm font-medium">{monthLabel(month)}</span>
            <button aria-label="Next month" className="px-2 text-slate-400 hover:text-slate-600" onClick={() => setMonth((m) => shiftMonth(m, 1))}>›</button>
          </div>
        )}
      </header>

      <main className="pb-24">
        {tab === 'dashboard' && <Dashboard month={month} onEditTx={(tx) => setModal({ kind: 'tx', tx })} />}
        {tab === 'transactions' && <Transactions month={month} onEditTx={(tx) => setModal({ kind: 'tx', tx })} />}
        {tab === 'car' && (
          <Car
            onAddVehicle={() => setModal({ kind: 'vehicle' })}
            onEditVehicle={(vehicle) => setModal({ kind: 'vehicle', vehicle })}
            onAddFuel={(vehicleId) => setModal({ kind: 'fuel', vehicleId })}
            onEditFuel={(vehicleId, entry) => setModal({ kind: 'fuel', vehicleId, entry })}
          />
        )}
        {tab === 'plan' && (
          <Plan
            onAddRule={() => setModal({ kind: 'recurring' })}
            onEditRule={(rule) => setModal({ kind: 'recurring', rule })}
            onCreateFromSuggestion={(suggestion) => setModal({ kind: 'recurring', suggestion })}
          />
        )}
        {tab === 'manage' && (
          <Manage
            onAddAccount={() => setModal({ kind: 'account' })}
            onEditAccount={(account) => setModal({ kind: 'account', account })}
            onTransfer={() => setModal({ kind: 'transfer' })}
            onAddCategory={() => setModal({ kind: 'category' })}
            onEditCategory={(category) => setModal({ kind: 'category', category })}
          />
        )}
      </main>

      {/* FAB */}
      <button
        onClick={onFab}
        aria-label={noAccounts ? 'Add account' : 'Add transaction'}
        className="fixed bottom-20 right-4 z-20 flex h-14 w-14 items-center justify-center rounded-full bg-blue-600 text-3xl text-white shadow-lg hover:bg-blue-700"
        style={{ marginBottom: 'env(safe-area-inset-bottom)' }}
      >
        +
      </button>

      {/* bottom nav */}
      <nav className="fixed inset-x-0 bottom-0 z-10 grid grid-cols-5 border-t border-slate-200 bg-white pb-[env(safe-area-inset-bottom)] dark:border-slate-800 dark:bg-slate-900">
        {(['dashboard', 'transactions', 'car', 'plan', 'manage'] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`py-3 text-sm font-medium capitalize ${tab === t ? 'text-blue-600' : 'text-slate-400'}`}
          >
            {t}
          </button>
        ))}
      </nav>

      {modal?.kind === 'tx' && (
        <Modal title={modal.tx ? 'Edit transaction' : 'Add transaction'} onClose={close}>
          <TransactionForm tx={modal.tx} accounts={accounts.data ?? []} categories={categories.data ?? []} onClose={close} />
        </Modal>
      )}
      {modal?.kind === 'account' && (
        <Modal title={modal.account ? 'Edit account' : 'Add account'} onClose={close}>
          <AccountForm account={modal.account} onClose={close} />
        </Modal>
      )}
      {modal?.kind === 'transfer' && (
        <Modal title="Transfer" onClose={close}>
          <TransferForm accounts={accounts.data ?? []} onClose={close} />
        </Modal>
      )}
      {modal?.kind === 'category' && (
        <Modal title={modal.category ? 'Edit category' : 'Add category'} onClose={close}>
          <CategoryForm category={modal.category} categories={categories.data ?? []} onClose={close} />
        </Modal>
      )}
      {modal?.kind === 'vehicle' && (
        <Modal title={modal.vehicle ? 'Edit vehicle' : 'Add vehicle'} onClose={close}>
          <VehicleForm vehicle={modal.vehicle} onClose={close} />
        </Modal>
      )}
      {modal?.kind === 'fuel' && (
        <Modal title={modal.entry ? 'Edit fuel entry' : 'Add fuel'} onClose={close}>
          <FuelForm vehicleId={modal.vehicleId} entry={modal.entry} onClose={close} />
        </Modal>
      )}
      {modal?.kind === 'recurring' && (
        <Modal title={modal.rule ? 'Edit rule' : 'Add recurring rule'} onClose={close}>
          <RecurringForm
            rule={modal.rule}
            suggestion={modal.suggestion}
            accounts={accounts.data ?? []}
            categories={categories.data ?? []}
            onClose={close}
          />
        </Modal>
      )}
    </div>
  );
}
