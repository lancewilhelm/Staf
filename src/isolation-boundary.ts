import {z} from 'zod';

/** Selection is a prerequisite, never proof that an execution is isolated. */
export function scratchPlatformAvailable(platform:NodeJS.Platform):boolean {return platform==='linux';}

const absentList=z.union([z.null(),z.array(z.never()).length(0)]);
const record=z.object({
 Image:z.string(),Config:z.object({User:z.string(),WorkingDir:z.string(),Entrypoint:z.array(z.string()),Cmd:z.array(z.string()),Env:z.array(z.string())}),
 HostConfig:z.object({Privileged:z.boolean(),ReadonlyRootfs:z.boolean(),NetworkMode:z.string(),PidMode:z.string(),IpcMode:z.string(),UTSMode:z.string(),CgroupnsMode:z.string(),CapDrop:z.array(z.string()),CapAdd:absentList.optional(),SecurityOpt:z.array(z.string()),Binds:absentList.optional(),Mounts:absentList.optional(),Devices:absentList.optional(),DeviceRequests:absentList.optional(),GroupAdd:absentList.optional(),VolumesFrom:absentList.optional(),Tmpfs:z.record(z.string(),z.string())}),
 Mounts:z.array(z.object({Type:z.string(),Destination:z.string()})),
});
/** Verify the daemon's observed configuration before starting untrusted code. */
export function inspectScratchContainer(value:unknown,imageId:string,limits:{sizeBytes:number;maxInodes:number},command:string):void {
 const parsed=record.safeParse(value);if(!parsed.success)throw Error('Cannot establish sandbox configuration');
 const {Image,Config,HostConfig:h,Mounts}=parsed.data;
 const tmp=`rw,nosuid,nodev,noexec,size=${limits.sizeBytes},nr_inodes=${limits.maxInodes},uid=65534,gid=65534,mode=0700`;
 const safeEnv=new Set(['PATH=/usr/bin:/bin','HOME=/nonexistent']);
 if(Image!==imageId || Config.User!=='65534:65534' || Config.WorkingDir!=='/workspace' || JSON.stringify(Config.Entrypoint)!==JSON.stringify(['/bin/sh']) || JSON.stringify(Config.Cmd)!==JSON.stringify(['-c',scratchEntryScript,'staf-scratch',command]) || Config.Env.length!==2 || Config.Env.some(value=>!safeEnv.has(value)) || new Set(Config.Env).size!==2 || h.Privileged || !h.ReadonlyRootfs || h.NetworkMode!=='none' || h.PidMode!=='' || h.IpcMode!=='private' || h.UTSMode!=='' || h.CgroupnsMode!=='private' || !h.CapDrop.includes('ALL') || h.SecurityOpt.length!==2 || !h.SecurityOpt.includes('no-new-privileges') || !h.SecurityOpt.includes('seccomp=builtin') || Object.keys(h.Tmpfs).length!==1 || h.Tmpfs['/workspace']!==tmp || Mounts.some(mount=>mount.Type!=='tmpfs' || mount.Destination!=='/workspace'))throw Error('Cannot establish sandbox configuration');
}

export function inspectDockerInfo(value:unknown):void {
 const parsed=z.object({OSType:z.literal('linux'),SecurityOptions:z.array(z.string())}).safeParse(value);
 if(!parsed.success || !parsed.data.SecurityOptions.some(option=>/^name=seccomp(?:,|$)/.test(option)))throw Error('Linux Docker seccomp is unavailable');
}

/** A fixed wrapper checks inherited kernel state inside the container before execution. */
export const scratchEntryScript=`staf_command=$1
staf_sec=0; staf_nnp=0; staf_eff=0; staf_prm=0; staf_bnd=0
while read -r staf_field staf_value staf_rest; do
 case "$staf_field:$staf_value" in
  Seccomp::2) staf_sec=1;; NoNewPrivs::1) staf_nnp=1;;
  CapEff::0000000000000000) staf_eff=1;; CapPrm::0000000000000000) staf_prm=1;; CapBnd::0000000000000000) staf_bnd=1;;
 esac
done < /proc/self/status || exit 125
test "$staf_sec$staf_nnp$staf_eff$staf_prm$staf_bnd" = 11111 || exit 125
exec /bin/sh -c "$staf_command"`;
