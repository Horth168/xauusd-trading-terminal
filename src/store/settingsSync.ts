import { cloudActive, getOne, saveDoc, useAuth } from '../lib/db';
import { syncableSettings, useSettings } from './settings';

/** Keeps settings (timezone, layouts, templates...) in the cloud so phone and PC share them. */
let started = false;
export function startSettingsSync() {
  if (started) return;
  started = true;
  let applying = false;
  let timer: number | undefined;

  const pull = async () => {
    if (!cloudActive()) return;
    const remote = await getOne<any>('settings', 'main').catch(() => null);
    if (remote?.data) {
      applying = true;
      useSettings.setState({ ...remote.data, bridgeToken: useSettings.getState().bridgeToken });
      applying = false;
    }
  };

  pull();
  useAuth.subscribe((s, p) => { if (s.user?.uid !== p.user?.uid) pull(); });
  useSettings.subscribe((s) => {
    if (applying || !cloudActive()) return;
    clearTimeout(timer);
    timer = window.setTimeout(() => {
      const { set, updateChart, ...plain } = s as any;
      void set; void updateChart;
      saveDoc('settings', { id: 'main', data: syncableSettings(plain) } as any).catch((e) => console.warn('settings sync failed', e));
    }, 1500);
  });
}
