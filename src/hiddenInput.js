import readline from 'node:readline';

export async function askHidden(label) {
  if (!process.stdin.isTTY || typeof process.stdin.setRawMode !== 'function') {
    throw new Error('Hidden password input requires an interactive PowerShell terminal.');
  }
  return new Promise((resolve, reject) => {
    let value = '';
    const input = process.stdin;
    const onKey = (character, key = {}) => {
      if (key.ctrl && key.name === 'c') {
        cleanup();
        reject(new Error('Cancelled.'));
        return;
      }
      if (key.name === 'return' || key.name === 'enter') {
        cleanup();
        process.stdout.write('\n');
        resolve(value);
        return;
      }
      if (key.name === 'backspace') {
        value = value.slice(0, -1);
        process.stdout.write('\b \b');
        return;
      }
      if (character && !key.ctrl && !key.meta) {
        value += character;
        process.stdout.write('*');
      }
    };
    const cleanup = () => {
      input.removeListener('keypress', onKey);
      input.setRawMode(false);
      input.pause();
    };
    readline.emitKeypressEvents(input);
    input.setRawMode(true);
    input.resume();
    input.on('keypress', onKey);
    process.stdout.write(label);
  });
}
