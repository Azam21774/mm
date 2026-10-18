import Dexie from 'dexie';


export const ddb = new Dexie('io');


ddb.version(1).stores({
  tagLists: "++id, name, mode,count",
  tagListItems: "++id, listId, content",
  valueTags: "++id,name,value"
  });
  