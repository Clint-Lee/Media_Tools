'use strict';
const assert=require('node:assert/strict'),fs=require('fs'),path=require('path'),vm=require('vm'),{EventEmitter}=require('events');
const {jsRuntimeArgs}=require('../lib/yt-dlp-parser');
assert.deepEqual(jsRuntimeArgs({env:{},version:'20.20.0',executable:'old-node'}),[],'不能强制旧Node进入EJS');
assert.deepEqual(jsRuntimeArgs({env:{},version:'24.0.0',executable:'new-node'}),['--js-runtimes','node:new-node']);
assert.deepEqual(jsRuntimeArgs({env:{YTDLP_JS_RUNTIME:'deno:C:/My Tools/deno.exe'}}),['--js-runtimes','deno:C:/My Tools/deno.exe']);
assert.deepEqual(jsRuntimeArgs({env:{YTDLP_JS_RUNTIME:'deno'}}),['--js-runtimes','deno']);
for(const value of ['python:/bin/python','node:x\n--exec','https://unknown.invalid/runtime'])assert.throws(()=>jsRuntimeArgs({env:{YTDLP_JS_RUNTIME:value}}),/YTDLP_JS_RUNTIME/);
let args;
const fakeSpawn=(program,argv)=>{
    args=argv;const child=new EventEmitter();child.stdout=new EventEmitter();child.stderr=new EventEmitter();
    child.stdout.setEncoding=child.stderr.setEncoding=()=>{};child.kill=()=>{};
    process.nextTick(()=>{child.stdout.emit('data','{"id":"abcdefghijk"}');child.emit('close',0);});return child;
};
const sandboxModule={exports:{}};
vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../lib/yt-dlp-parser.js'),'utf8'),{
    require:name=>name==='child_process'?{spawn:fakeSpawn}:name==='fs'?{existsSync:()=>true}:name==='./platform-session'?{cookieFile:()=>null}:require(name),
    module:sandboxModule,__dirname:path.resolve(__dirname,'../lib'),setTimeout,clearTimeout,
    process:{env:{},versions:{node:'20.20.0'},execPath:'old-node',platform:'win32'},URL
});
(async()=>{
    const result=await sandboxModule.exports.extractMetadata('https://www.youtube.com/watch?v=abcdefghijk');
    assert.equal(result.id,'abcdefghijk');assert.ok(!args.includes('--js-runtimes'));
    for(const flag of ['--no-remote-components','--no-plugin-dirs','--skip-download','--ignore-config'])assert.ok(args.includes(flag));
    console.log('yt-dlp runtime passed: supported Node selection, explicit Deno, no forced Node20, no remote components and production argv (mocked process)');
})().catch(error=>{console.error(error);process.exitCode=1;});
