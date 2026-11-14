/* Open exactly one workspace object with kernel-enforced path containment. */
#ifndef __linux__
#include <stdio.h>
int main(void) { fputs("Linux file boundary unavailable\n",stderr);return 125; }
#else
#define _GNU_SOURCE
#include <errno.h>
#include <fcntl.h>
#include <linux/openat2.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/syscall.h>
#include <unistd.h>

static void fail(void) { fputs("Isolated file open failed\n",stderr);_exit(125); }
static void require(int condition) { if(!condition)fail(); }
static int digit(unsigned char c) {
 if(c>='A'&&c<='Z')return c-'A';if(c>='a'&&c<='z')return c-'a'+26;
 if(c>='0'&&c<='9')return c-'0'+52;if(c=='+')return 62;if(c=='/')return 63;return -1;
}
static size_t line(char *out,size_t max) {
 size_t n=0;for(;;){char c;ssize_t got=read(0,&c,1);if(got<0&&errno==EINTR)continue;require(got==1);if(c=='\n')break;require(n<max);out[n++]=c;}out[n]='\0';return n;
}
static void decode(char *out,const char *in,size_t n) {
 require(n>0 && n%4==0);size_t used=0;
 for(size_t i=0;i<n;i+=4){int a=digit(in[i]),b=digit(in[i+1]),c=in[i+2]=='='?-1:digit(in[i+2]),d=in[i+3]=='='?-1:digit(in[i+3]);
  require(a>=0&&b>=0&&(c>=0||in[i+2]=='=')&&(d>=0||in[i+3]=='=')&&(c>=0||d<0));
  require((c>=0&&d>=0)||i+4==n);require(used<4096);out[used++]=(char)((a<<2)|(b>>4));
  if(c>=0){require(used<4096);out[used++]=(char)((b<<4)|(c>>2));}if(d>=0){require(used<4096);out[used++]=(char)((c<<6)|d);}
 }
 require(!memchr(out,'\0',used));out[used]='\0';require(out[0]!='/' && used>0);
}
int main(int argc,char **argv) {
 (void)argv;require(argc==1);char encoded[5465],path[4097],operation[16];
 size_t n=line(encoded,sizeof(encoded)-1);decode(path,encoded,n);line(operation,sizeof(operation)-1);
 int flags=O_NONBLOCK|O_NOFOLLOW;
 if(!strcmp(operation,"read")||!strcmp(operation,"search")||!strcmp(operation,"verify"))flags|=O_RDONLY;
 else if(!strcmp(operation,"write"))flags|=O_WRONLY|O_CREAT;
 else if(!strcmp(operation,"edit"))flags|=O_RDWR;
 else fail();
 int root=open("/workspace",O_PATH|O_DIRECTORY|O_CLOEXEC);require(root>=0);
 struct open_how how={.flags=(uint64_t)flags,.mode=flags&O_CREAT?0666:0,.resolve=RESOLVE_BENEATH|RESOLVE_NO_MAGICLINKS|RESOLVE_NO_SYMLINKS|RESOLVE_NO_XDEV};
 int fd=(int)syscall(SYS_openat2,root,path,&how,sizeof(how));require(fd>=0);close(root);
 if(fd!=3){require(dup2(fd,3)==3);close(fd);}require(fcntl(3,F_SETFD,0)==0);
 require(syscall(SYS_close_range,4U,~0U,0)==0);
 char *const args[]={"/usr/bin/node","/usr/lib/staf-exec/staf-file-worker.mjs",NULL};execv(args[0],args);fail();
}
#endif
