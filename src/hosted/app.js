// firebase/app shim for the hosted build.
const apps = [];
export function initializeApp(options, name = '[DEFAULT]') {
  const a = { name, options };
  apps.push(a);
  return a;
}
export function getApps() { return apps; }
export async function deleteApp(a) {
  const i = apps.indexOf(a);
  if (i >= 0) apps.splice(i, 1);
}
