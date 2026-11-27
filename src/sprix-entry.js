#!/usr/bin/env node
import { Command } from 'commander';
import { registerSprixCommands } from './sprix.js';

const program = new Command()
  .name('sprix')
  .description('SPRIX Learning Square API and local study CLI')
  .version('0.6.0');

registerSprixCommands(program, { standalone: true });
program.showHelpAfterError();
program.parseAsync(process.argv).catch(error => {
  console.error('Error: ' + error.message);
  process.exitCode = 1;
});
