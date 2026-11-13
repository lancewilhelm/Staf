/* The kernel's mountinfo format escapes spaces, tabs, newlines and backslashes,
 * but not slashes. The two fixed prefixes therefore cannot be hidden by an
 * escaped character. Called only after the launcher's mounts are established. */
#ifndef STAF_EXEC_MOUNTINFO_H
#define STAF_EXEC_MOUNTINFO_H
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static int staf_mounts_are_safe(FILE *mounts) {
  char *line=NULL; size_t size=0; int workspace=0,usr=0,safe=1;
  while(getline(&line,&size,mounts)>=0) {
    char *save=NULL,*token=strtok_r(line," ",&save);
    for(int i=0;i<4 && token;i++)token=strtok_r(NULL," ",&save);
    if(!token || strncmp(token,"/workspace/",11)==0 || strncmp(token,"/usr/",5)==0) {safe=0;break;}
    if(strcmp(token,"/workspace")==0)workspace++;
    if(strcmp(token,"/usr")==0)usr++;
  }
  if(ferror(mounts) || workspace!=1 || usr!=1)safe=0;
  free(line);return safe;
}
#endif
