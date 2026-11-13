/* Fixed in-sandbox guard for the operator-installed host-work launcher.
 * It accepts no command-line policy or executable selection. */
#ifndef __linux__
#include <stdio.h>
int main(void) { fputs("Linux execution guard unavailable\n", stderr); return 125; }
#else
#define _GNU_SOURCE
#include <errno.h>
#include <fcntl.h>
#include <grp.h>
#include <linux/capability.h>
#include <linux/openat2.h>
#include <sched.h>
#include <seccomp.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/prctl.h>
#include <sys/socket.h>
#include <sys/stat.h>
#include <sys/syscall.h>
#include <termios.h>
#include <unistd.h>
#include "staf-exec-mountinfo.h"

#define LL_VERSION 1U
#define LL_RESOLVE_UNIX (1ULL << 16)
#define LL_SCOPE_ABSTRACT (1ULL << 0)
#define LL_SCOPE_SIGNAL (1ULL << 1)
#define MAX_COMMAND 32000
#define MAX_CWD 4096
struct ll_ruleset_v6 { uint64_t fs; uint64_t net; uint64_t scoped; };

static void fail(void) { fputs("Staf execution boundary unavailable\n", stderr); _exit(125); }
static void require(int condition) { if (!condition) fail(); }

static void check_identity(void) {
  struct __user_cap_header_struct h = {_LINUX_CAPABILITY_VERSION_3, 0};
  struct __user_cap_data_struct data[2] = {{0}};
  uid_t ruid,euid,suid;gid_t rgid,egid,sgid;
  require(getresuid(&ruid,&euid,&suid)==0 && getresgid(&rgid,&egid,&sgid)==0);
  require(ruid==65534 && euid==65534 && suid==65534 && rgid==65534 && egid==65534 && sgid==65534);
  int count=getgroups(0,NULL); require(count>=0 && count<=1);
  if(count==1) { gid_t group; require(getgroups(1,&group)==1 && group==65534); }
  require(syscall(SYS_capget,&h,data)==0);
  for(int i=0;i<2;i++) require(!data[i].effective && !data[i].permitted && !data[i].inheritable);
  int cap;
  for(cap=0;cap<256;cap++) {
    int present=prctl(PR_CAPBSET_READ,cap,0,0,0);
    if(present<0 && errno==EINVAL)break;
    require(present==0);
  }
  require(cap>CAP_LAST_CAP && cap<256);
  require(prctl(PR_GET_NO_NEW_PRIVS,0,0,0,0)==1);
}

/* Bubblewrap bind mounts recursively. A mount hidden inside either exported
 * tree could otherwise expose a host filesystem, even when cwd is checked. */
static void check_mounts(void) {
  FILE *mounts=fopen("/proc/self/mountinfo","re"); require(mounts!=NULL);
  require(staf_mounts_are_safe(mounts)); require(fclose(mounts)==0);
}

static void apply_landlock(void) {
  require(syscall(SYS_landlock_create_ruleset,NULL,0,LL_VERSION)>=9);
  struct ll_ruleset_v6 attr={LL_RESOLVE_UNIX,0,LL_SCOPE_ABSTRACT|LL_SCOPE_SIGNAL};
  int fd=(int)syscall(SYS_landlock_create_ruleset,&attr,sizeof(attr),0); require(fd>=0);
  require(syscall(SYS_landlock_restrict_self,fd,0)==0); require(close(fd)==0);
}

static void apply_seccomp(void) {
  scmp_filter_ctx filter=seccomp_init(SCMP_ACT_ALLOW); require(filter!=NULL);
  require(seccomp_attr_set(filter,SCMP_FLTATR_ACT_BADARCH,SCMP_ACT_KILL_PROCESS)==0);
  const char *blocked[]={"unshare","setns","mount","umount2","pivot_root","open_by_handle_at","ptrace","process_vm_readv","process_vm_writev","pidfd_getfd","kcmp","bpf","keyctl","add_key","request_key","io_uring_setup","io_uring_enter","io_uring_register","userfaultfd","perf_event_open","open_tree","move_mount","fsopen","fsconfig","fsmount","mount_setattr"};
  for(size_t i=0;i<sizeof(blocked)/sizeof(blocked[0]);i++) {
    int nr=seccomp_syscall_resolve_name(blocked[i]); require(nr!=__NR_SCMP_ERROR);
    require(seccomp_rule_add(filter,SCMP_ACT_ERRNO(EPERM),nr,0)==0);
  }
  /* A network namespace alone does not isolate every socket family (for
   * example, vsock). Permit only Unix sockets; Landlock scopes those. */
  require(seccomp_rule_add(filter,SCMP_ACT_ERRNO(EPERM),SCMP_SYS(socket),1,SCMP_A0(SCMP_CMP_NE,AF_UNIX,0))==0);
  require(seccomp_rule_add(filter,SCMP_ACT_ERRNO(EPERM),SCMP_SYS(socketpair),1,SCMP_A0(SCMP_CMP_NE,AF_UNIX,0))==0);
  int clone3=seccomp_syscall_resolve_name("clone3"); require(clone3!=__NR_SCMP_ERROR);
  require(seccomp_rule_add(filter,SCMP_ACT_ERRNO(ENOSYS),clone3,0)==0);
  const unsigned long flags[]={CLONE_NEWUSER,CLONE_NEWNS,CLONE_NEWNET,CLONE_NEWPID,CLONE_NEWIPC,CLONE_NEWUTS,CLONE_NEWCGROUP};
  for(size_t i=0;i<sizeof(flags)/sizeof(flags[0]);i++)
    require(seccomp_rule_add(filter,SCMP_ACT_ERRNO(EPERM),SCMP_SYS(clone),1,SCMP_A0(SCMP_CMP_MASKED_EQ,flags[i],flags[i]))==0);
  require(seccomp_load(filter)==0); seccomp_release(filter);
  require(prctl(PR_GET_SECCOMP,0,0,0,0)==2);
}

static int digit64(unsigned char c) {
  if(c>='A' && c<='Z')return c-'A'; if(c>='a' && c<='z')return c-'a'+26;
  if(c>='0' && c<='9')return c-'0'+52; if(c=='+')return 62; if(c=='/')return 63; return -1;
}
/* Strict bounded base64 line; reads one byte at a time so later terminal input remains unread. */
static char *read_line(size_t max) {
  size_t encoded=((max+2)/3)*4, used=0; char *line=malloc(encoded+1); require(line!=NULL);
  for(;;) { unsigned char c; ssize_t n=read(STDIN_FILENO,&c,1); if(n<0 && errno==EINTR)continue; require(n==1); if(c=='\n')break; require(used<encoded && c!='\r'); line[used++]=(char)c; }
  require(used>0 && used%4==0); char *out=malloc(max+1); require(out!=NULL); size_t outlen=0;
  for(size_t i=0;i<used;i+=4) {
    int a=digit64(line[i]),b=digit64(line[i+1]),c=line[i+2]=='='?-1:digit64(line[i+2]),d=line[i+3]=='='?-1:digit64(line[i+3]);
    require(a>=0 && b>=0 && (c>=0 || line[i+2]=='=') && (d>=0 || line[i+3]=='=') && (c>=0 || d<0));
    require((c>=0 && d>=0) || i+4==used); require(outlen<max); out[outlen++]=(char)((a<<2)|(b>>4));
    if(c>=0){require(outlen<max);out[outlen++]=(char)((b<<4)|(c>>2));} if(d>=0){require(outlen<max);out[outlen++]=(char)((c<<6)|d);}
  }
  require(!memchr(out,'\0',outlen));out[outlen]='\0';free(line);return out;
}

int main(int argc,char **argv) {
  (void)argv;require(argc==1);check_identity();check_mounts();
  require(syscall(SYS_close_range,3U,~0U,0)==0);
  apply_landlock();apply_seccomp();
  struct termios saved,quiet; int tty=isatty(STDIN_FILENO);
  if(tty){require(tcgetattr(STDIN_FILENO,&saved)==0);quiet=saved;quiet.c_lflag&=(tcflag_t)~(ECHO|ICANON);quiet.c_iflag&=(tcflag_t)~(ICRNL|INLCR|IGNCR|IXON);quiet.c_cc[VMIN]=1;quiet.c_cc[VTIME]=0;require(tcsetattr(STDIN_FILENO,TCSANOW,&quiet)==0);}
  const char ready[]="STAF-EXEC-READY-1\n";require(write(STDOUT_FILENO,ready,sizeof(ready)-1)==(ssize_t)(sizeof(ready)-1));
  char *cwd=read_line(MAX_CWD),*command=read_line(MAX_COMMAND);
  if(tty)require(tcsetattr(STDIN_FILENO,TCSANOW,&saved)==0);
  require(cwd[0]!='/' && command[0]!='\0');
  int root=open("/workspace",O_PATH|O_DIRECTORY|O_CLOEXEC);require(root>=0);
  struct open_how how={.flags=O_PATH|O_DIRECTORY|O_CLOEXEC,.resolve=RESOLVE_BENEATH|RESOLVE_NO_MAGICLINKS|RESOLVE_NO_XDEV};
  int dir=(int)syscall(SYS_openat2,root,cwd,&how,sizeof(how));require(dir>=0 && fchdir(dir)==0);close(dir);close(root);free(cwd);
  char *const args[]={"/bin/sh","-c",command,NULL};execv(args[0],args);fail();
}
#endif
