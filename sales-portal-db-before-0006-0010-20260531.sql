PRAGMA defer_foreign_keys=TRUE;
CREATE TABLE d1_migrations(
		id         INTEGER PRIMARY KEY AUTOINCREMENT,
		name       TEXT UNIQUE,
		applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
);
INSERT INTO "d1_migrations" ("id","name","applied_at") VALUES(1,'0000_init.sql','2026-05-02 10:49:01');
INSERT INTO "d1_migrations" ("id","name","applied_at") VALUES(2,'0001_reviewer_options.sql','2026-05-02 10:49:01');
INSERT INTO "d1_migrations" ("id","name","applied_at") VALUES(3,'0002_pi_sender_requirements.sql','2026-05-02 10:49:01');
INSERT INTO "d1_migrations" ("id","name","applied_at") VALUES(4,'0003_approved_with_edits.sql','2026-05-17 08:28:52');
INSERT INTO "d1_migrations" ("id","name","applied_at") VALUES(5,'0004_submitted_snapshot.sql','2026-05-17 08:28:52');
INSERT INTO "d1_migrations" ("id","name","applied_at") VALUES(6,'0005_pi_number_sequences.sql','2026-05-17 08:28:53');
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  passwordHash TEXT NOT NULL,
  displayName TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('ADMIN', 'USER')),
  createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "users" ("id","username","passwordHash","displayName","role","createdAt") VALUES('usr_877faa714bd04a93ac35f2de9a8f6794','Jane','$2b$10$bEOtEAklIppzJvNLAQLRr.NUsjO7MA0C8aP52ElZvIdSf0pprXxqq','Jane','ADMIN','2026-05-02 11:13:05');
INSERT INTO "users" ("id","username","passwordHash","displayName","role","createdAt") VALUES('usr_5b97c9c2930b4725ba4da3fb862e53df','Milton','$2b$10$qKsJqlbp31Ud2U2If9wwcub6f.LXbWcbnQZOae7j75jkxwkUGYmJ2','Milton','ADMIN','2026-05-31 13:29:05');
CREATE TABLE categories (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  nameEn TEXT NOT NULL,
  nameZh TEXT NOT NULL
);
INSERT INTO "categories" ("id","code","nameEn","nameZh") VALUES('cat_9cfe96928b8d4d129d84613024988977','GENERAL','General','General');
CREATE TABLE products (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  nameEn TEXT NOT NULL,
  nameZh TEXT NOT NULL,
  categoryId TEXT NOT NULL REFERENCES categories(id),
  status TEXT NOT NULL CHECK (status IN ('ACTIVE', 'DISCONTINUED'))
);
INSERT INTO "products" ("id","code","nameEn","nameZh","categoryId","status") VALUES('pro_96688b3ebf3b4083a1cd5cd613cd2dec','product-motf7ci6-ypf1a','Injet Swift 2.0 AC EV Charger','Injet Swift 2.0电动汽车交流桩','cat_9cfe96928b8d4d129d84613024988977','ACTIVE');
CREATE TABLE productTemplates (
  id TEXT PRIMARY KEY,
  productId TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  language TEXT NOT NULL CHECK (language IN ('EN', 'ZH')),
  r2Key TEXT NOT NULL,
  uploadedById TEXT NOT NULL REFERENCES users(id),
  uploadedAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(productId, language)
);
CREATE TABLE productFields (
  id TEXT PRIMARY KEY,
  productId TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  language TEXT NOT NULL CHECK (language IN ('EN', 'ZH')),
  label TEXT NOT NULL,
  fieldType TEXT NOT NULL CHECK (fieldType IN ('TEXT', 'DROPDOWN')),
  options TEXT,
  defaultValue TEXT,
  sortOrder INTEGER NOT NULL DEFAULT 0
);
INSERT INTO "productFields" ("id","productId","language","label","fieldType","options","defaultValue","sortOrder") VALUES('fld_cb5943b4f31a4a56b0901d8b7550865b','pro_96688b3ebf3b4083a1cd5cd613cd2dec','EN','Model','DROPDOWN','["iM3B-07K0T","iM3B-11K0T","iM3B-22K0T","iM3W-07K0T","iM3W-11K0T","iM3W-22K0T"]','',0);
INSERT INTO "productFields" ("id","productId","language","label","fieldType","options","defaultValue","sortOrder") VALUES('fld_812db9f0f89d4731aac3859adf926875','pro_96688b3ebf3b4083a1cd5cd613cd2dec','EN','Wattage','DROPDOWN','["7kW","11kW","22kW"]','',1);
INSERT INTO "productFields" ("id","productId","language","label","fieldType","options","defaultValue","sortOrder") VALUES('fld_8bf69b168e94445b9f0e9815c59c96a5','pro_96688b3ebf3b4083a1cd5cd613cd2dec','EN','Version','DROPDOWN','["Wifi + Bluetooth + LAN + MID","Wifi + Bluetooth + LAN + MID + 4G"]','',2);
INSERT INTO "productFields" ("id","productId","language","label","fieldType","options","defaultValue","sortOrder") VALUES('fld_f3b18238eaee4266b091129200c9b09e','pro_96688b3ebf3b4083a1cd5cd613cd2dec','EN','Charging Interface','DROPDOWN','["Type 2"]','',3);
INSERT INTO "productFields" ("id","productId","language","label","fieldType","options","defaultValue","sortOrder") VALUES('fld_cc291b02c78e441eaeeb3f038ebbed96','pro_96688b3ebf3b4083a1cd5cd613cd2dec','EN','Cable Configuration','DROPDOWN','["Case B","T2S Case B","5-meter Cable","7.5-meter Cable"]','',4);
INSERT INTO "productFields" ("id","productId","language","label","fieldType","options","defaultValue","sortOrder") VALUES('fld_b26de42e39a647ab90824ca748ab0963','pro_96688b3ebf3b4083a1cd5cd613cd2dec','EN','Power Control','DROPDOWN','["No external load balencing","DLB (APCC)","DLB (485CT)","Solar Logic + DLB","Power sharing"]','',5);
INSERT INTO "productFields" ("id","productId","language","label","fieldType","options","defaultValue","sortOrder") VALUES('fld_077fd98d37b142c1a65b0ebf9538e1bb','pro_96688b3ebf3b4083a1cd5cd613cd2dec','EN','OCPP Platform','TEXT','[]','None',6);
INSERT INTO "productFields" ("id","productId","language","label","fieldType","options","defaultValue","sortOrder") VALUES('fld_6441075017e249cc9803d9444ac71756','pro_96688b3ebf3b4083a1cd5cd613cd2dec','EN','OCPP Protocol','DROPDOWN','["None","OCPP 1.6J"]','',7);
INSERT INTO "productFields" ("id","productId","language","label","fieldType","options","defaultValue","sortOrder") VALUES('fld_866ae1b376d946e89fc628118a6dc5b1','pro_96688b3ebf3b4083a1cd5cd613cd2dec','EN','Power-off Screen','DROPDOWN','["Yes - 7-inch touchscreen"]','Yes - 7-inch touchscreen',8);
INSERT INTO "productFields" ("id","productId","language","label","fieldType","options","defaultValue","sortOrder") VALUES('fld_8c83dfeb29d7432b8b936cc8eeb38549','pro_96688b3ebf3b4083a1cd5cd613cd2dec','EN','RFID Card','DROPDOWN','["Offline card, Neutral, 2 per unit","Online card, Neutral, 2 per unit"]','',9);
INSERT INTO "productFields" ("id","productId","language","label","fieldType","options","defaultValue","sortOrder") VALUES('fld_fc9b95dcab504d76816f17409091f171','pro_96688b3ebf3b4083a1cd5cd613cd2dec','EN','Startup Mode','DROPDOWN','["Read Card"]','',10);
INSERT INTO "productFields" ("id","productId","language","label","fieldType","options","defaultValue","sortOrder") VALUES('fld_38f9ba442ea1443093a57e83af015361','pro_96688b3ebf3b4083a1cd5cd613cd2dec','EN','Wifi','TEXT','[]','wydq',11);
INSERT INTO "productFields" ("id","productId","language","label","fieldType","options","defaultValue","sortOrder") VALUES('fld_8d41b39060ca4611a1ba6aa1b766f5de','pro_96688b3ebf3b4083a1cd5cd613cd2dec','EN','Language','DROPDOWN','["English","German","French","Portuguese","Cantonese"]','',12);
INSERT INTO "productFields" ("id","productId","language","label","fieldType","options","defaultValue","sortOrder") VALUES('fld_73f35858094e4b2ab0b76f4ad0251b85','pro_96688b3ebf3b4083a1cd5cd613cd2dec','EN','Branding','DROPDOWN','["Neutral panel","Customized panel"]','',13);
INSERT INTO "productFields" ("id","productId","language","label","fieldType","options","defaultValue","sortOrder") VALUES('fld_817b20de727348fa90288cb1ed51d3e7','pro_96688b3ebf3b4083a1cd5cd613cd2dec','EN','Stop Button','TEXT','[]','E-stop button',14);
INSERT INTO "productFields" ("id","productId","language","label","fieldType","options","defaultValue","sortOrder") VALUES('fld_3ae6e9cd4e894df19a94e2ad924f5f36','pro_96688b3ebf3b4083a1cd5cd613cd2dec','ZH','OCPP平台','TEXT','[]','无/直接填写链接',0);
INSERT INTO "productFields" ("id","productId","language","label","fieldType","options","defaultValue","sortOrder") VALUES('fld_6a3cbe00b6ea4659ac2703746bb600a9','pro_96688b3ebf3b4083a1cd5cd613cd2dec','ZH','APP','DROPDOWN','["否","WE E Charge"]','',2);
INSERT INTO "productFields" ("id","productId","language","label","fieldType","options","defaultValue","sortOrder") VALUES('fld_f454002ae9f54b81a3ee0ed94f87a12a','pro_96688b3ebf3b4083a1cd5cd613cd2dec','ZH','OCPP版本','DROPDOWN','["否","OCPP 1.6J"]','',1);
INSERT INTO "productFields" ("id","productId","language","label","fieldType","options","defaultValue","sortOrder") VALUES('fld_71e818689fbd4c4f93fe1184c3008c5c','pro_96688b3ebf3b4083a1cd5cd613cd2dec','ZH','熄屏','DROPDOWN','["是","否"]','',3);
INSERT INTO "productFields" ("id","productId","language","label","fieldType","options","defaultValue","sortOrder") VALUES('fld_9a1048bff37f40a9b195792f900e5b31','pro_96688b3ebf3b4083a1cd5cd613cd2dec','ZH','RFID卡','DROPDOWN','["有序列号，中性，水晶卡；数量：2 张/台","无序列号，中性，水晶卡；数量：2 张/台"]','',4);
INSERT INTO "productFields" ("id","productId","language","label","fieldType","options","defaultValue","sortOrder") VALUES('fld_f93148620b364316ab252ba8348f77a4','pro_96688b3ebf3b4083a1cd5cd613cd2dec','ZH','Wifi','TEXT','[]','wydq',0);
INSERT INTO "productFields" ("id","productId","language","label","fieldType","options","defaultValue","sortOrder") VALUES('fld_076ea0c1c2b24b93a0b2738b39672127','pro_96688b3ebf3b4083a1cd5cd613cd2dec','ZH','启动方式','TEXT','[]','刷卡启动',0);
INSERT INTO "productFields" ("id","productId","language","label","fieldType","options","defaultValue","sortOrder") VALUES('fld_9bd402e0dcd9489a992b0730a34e41b5','pro_96688b3ebf3b4083a1cd5cd613cd2dec','ZH','面板','DROPDOWN','["定制logo，有视窗","英杰logo，有视窗","中性面板，无logo，有视窗"]','',0);
INSERT INTO "productFields" ("id","productId","language","label","fieldType","options","defaultValue","sortOrder") VALUES('fld_5d53794d2f0c422f8d7bcf2574f1bd98','pro_96688b3ebf3b4083a1cd5cd613cd2dec','ZH','屏幕语言','DROPDOWN','["英语","德语","法语","葡萄牙语","粤语"]','',0);
INSERT INTO "productFields" ("id","productId","language","label","fieldType","options","defaultValue","sortOrder") VALUES('fld_f03b7729d8124255aeeef022def1ee87','pro_96688b3ebf3b4083a1cd5cd613cd2dec','ZH','铭牌','DROPDOWN','["CE铭牌","中性铭牌","定制铭牌"]','',0);
CREATE TABLE pi (
  id TEXT PRIMARY KEY,
  language TEXT NOT NULL CHECK (language IN ('EN', 'ZH')),
  piNo TEXT NOT NULL UNIQUE,
  seq INTEGER NOT NULL,
  status TEXT NOT NULL,
  date TEXT NOT NULL,
  customerCompany TEXT NOT NULL,
  customerContact TEXT,
  customerEmail TEXT,
  customerPhone TEXT,
  customerCountry TEXT,
  customerAddress TEXT,
  validUntil TEXT,
  incoterm TEXT,
  shipmentMode TEXT,
  paymentTerm TEXT,
  productionOrderNo TEXT,
  customerSource TEXT,
  customerType TEXT,
  deliveryDate TEXT,
  rejectionNote TEXT,
  createdById TEXT NOT NULL REFERENCES users(id),
  createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  archivedAt TEXT
, assignedToId TEXT, senderCorp TEXT NOT NULL DEFAULT '', senderAddress TEXT NOT NULL DEFAULT '', senderFrom TEXT NOT NULL DEFAULT '', senderPhone TEXT NOT NULL DEFAULT '', senderEmail TEXT NOT NULL DEFAULT '', otherRequirements TEXT NOT NULL DEFAULT '', submittedSnapshot TEXT);
INSERT INTO "pi" ("id","language","piNo","seq","status","date","customerCompany","customerContact","customerEmail","customerPhone","customerCountry","customerAddress","validUntil","incoterm","shipmentMode","paymentTerm","productionOrderNo","customerSource","customerType","deliveryDate","rejectionNote","createdById","createdAt","updatedAt","archivedAt","assignedToId","senderCorp","senderAddress","senderFrom","senderPhone","senderEmail","otherRequirements","submittedSnapshot") VALUES('pi_e8827827225146a6b9731afbe09f37fe','ZH','INJET20060-CN-20260519002',2,'APPROVED','2026-05-19','Chinese PI','','','','','','','','','','','','','',NULL,'usr_877faa714bd04a93ac35f2de9a8f6794','2026-05-19 12:57:48','2026-05-19 12:58:50',NULL,'usr_877faa714bd04a93ac35f2de9a8f6794','','','','','','','{"header":{"language":"ZH","piNo":"INJET20060-CN-20260519002","date":"2026-05-19","customerCompany":"Chinese PI","customerContact":"","customerEmail":"","customerPhone":"","customerCountry":"","customerAddress":"","validUntil":"","incoterm":"","shipmentMode":"","paymentTerm":"","productionOrderNo":"","customerSource":"","customerType":"","deliveryDate":"","senderCorp":"","senderAddress":"","senderFrom":"","senderPhone":"","senderEmail":"","otherRequirements":""},"items":[]}');
INSERT INTO "pi" ("id","language","piNo","seq","status","date","customerCompany","customerContact","customerEmail","customerPhone","customerCountry","customerAddress","validUntil","incoterm","shipmentMode","paymentTerm","productionOrderNo","customerSource","customerType","deliveryDate","rejectionNote","createdById","createdAt","updatedAt","archivedAt","assignedToId","senderCorp","senderAddress","senderFrom","senderPhone","senderEmail","otherRequirements","submittedSnapshot") VALUES('pi_a36a215a47ac44dd94363a311dd17da1','EN','1',1,'DRAFT','2026-05-31','1','','','','','','','','','','','','','',NULL,'usr_877faa714bd04a93ac35f2de9a8f6794','2026-05-31 13:39:37','2026-05-31 13:39:37',NULL,NULL,'1','','','','','',NULL);
CREATE TABLE piItems (
  id TEXT PRIMARY KEY,
  piId TEXT NOT NULL REFERENCES pi(id) ON DELETE CASCADE,
  productId TEXT NOT NULL REFERENCES products(id),
  quantity REAL NOT NULL,
  unitPrice REAL NOT NULL,
  discountPct REAL NOT NULL DEFAULT 0,
  fieldValues TEXT NOT NULL,
  sortOrder INTEGER NOT NULL DEFAULT 0
);
INSERT INTO "piItems" ("id","piId","productId","quantity","unitPrice","discountPct","fieldValues","sortOrder") VALUES('itm_827e793627eb472ab819ba12556d5946','pi_a36a215a47ac44dd94363a311dd17da1','pro_96688b3ebf3b4083a1cd5cd613cd2dec',1,0,0,'[{"label":"__currency","value":"USD","fieldType":"TEXT","sortOrder":-1},{"label":"Model","value":"","fieldType":"DROPDOWN","options":["iM3B-07K0T","iM3B-11K0T","iM3B-22K0T","iM3W-07K0T","iM3W-11K0T","iM3W-22K0T"],"sortOrder":0},{"label":"Wattage","value":"","fieldType":"DROPDOWN","options":["7kW","11kW","22kW"],"sortOrder":1},{"label":"Version","value":"Wifi + Bluetooth + LAN + MID","fieldType":"DROPDOWN","options":["Wifi + Bluetooth + LAN + MID","Wifi + Bluetooth + LAN + MID + 4G"],"sortOrder":2},{"label":"Charging Interface","value":"","fieldType":"DROPDOWN","options":["Type 2"],"sortOrder":3},{"label":"Cable Configuration","value":"5-meter Cable","fieldType":"DROPDOWN","options":["Case B","T2S Case B","5-meter Cable","7.5-meter Cable"],"sortOrder":4},{"label":"Power Control","value":"","fieldType":"DROPDOWN","options":["No external load balencing","DLB (APCC)","DLB (485CT)","Solar Logic + DLB","Power sharing"],"sortOrder":5},{"label":"OCPP Platform","value":"None","fieldType":"TEXT","options":[],"sortOrder":6},{"label":"OCPP Protocol","value":"","fieldType":"DROPDOWN","options":["None","OCPP 1.6J"],"sortOrder":7},{"label":"Power-off Screen","value":"Yes - 7-inch touchscreen","fieldType":"DROPDOWN","options":["Yes - 7-inch touchscreen"],"sortOrder":8},{"label":"RFID Card","value":"","fieldType":"DROPDOWN","options":["Offline card, Neutral, 2 per unit","Online card, Neutral, 2 per unit"],"sortOrder":9},{"label":"Startup Mode","value":"","fieldType":"DROPDOWN","options":["Read Card"],"sortOrder":10},{"label":"Wifi","value":"wydq","fieldType":"TEXT","options":[],"sortOrder":11},{"label":"Language","value":"","fieldType":"DROPDOWN","options":["English","German","French","Portuguese","Cantonese"],"sortOrder":12},{"label":"Branding","value":"","fieldType":"DROPDOWN","options":["Neutral panel","Customized panel"],"sortOrder":13},{"label":"Stop Button","value":"E-stop button","fieldType":"TEXT","options":[],"sortOrder":14}]',0);
CREATE TABLE contractTemplates (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  language TEXT NOT NULL CHECK (language IN ('EN', 'ZH', 'BOTH')),
  r2Key TEXT NOT NULL,
  size INTEGER NOT NULL,
  uploadedById TEXT NOT NULL REFERENCES users(id),
  uploadedAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE excelTemplates (
  id TEXT PRIMARY KEY,
  language TEXT NOT NULL UNIQUE CHECK (language IN ('EN', 'ZH')),
  r2Key TEXT NOT NULL,
  anchorCellName TEXT NOT NULL DEFAULT 'PRODUCTS_START',
  uploadedById TEXT NOT NULL REFERENCES users(id),
  uploadedAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE senderProfile (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  corp TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  fromName TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT ''
);
INSERT INTO "senderProfile" ("id","corp","address","fromName","phone","email") VALUES(1,'','','','','');
CREATE TABLE appOptions (
  id TEXT PRIMARY KEY,
  optionKey TEXT NOT NULL,
  value TEXT NOT NULL,
  sortOrder INTEGER NOT NULL DEFAULT 0
);
INSERT INTO "appOptions" ("id","optionKey","value","sortOrder") VALUES('opt_62d111f1cb84489c83bf3cb53ae10f5d','productModelRule:pro_96688b3ebf3b4083a1cd5cd613cd2dec:EN','{"enabled":false,"prefix":"","prefixOptions":[],"separator":"-","segments":[]}',0);
INSERT INTO "appOptions" ("id","optionKey","value","sortOrder") VALUES('opt_e2c5d18d444f4bd2b28106804a4abfa3','productModelRule:pro_96688b3ebf3b4083a1cd5cd613cd2dec:ZH','{"enabled":true,"prefix":"","prefixOptions":[{"code":"iM3B-22K0T\t\t\t \t\t\t","description":""},{"code":"iM3W-22K0T\t\t\t \t\t\t","description":""},{"code":"iM3B-11K0T\t\t\t \t\t\t","description":""},{"code":"iM3W-11K0T\t\t\t \t\t\t","description":""},{"code":"iM3B-07K0T\t\t\t \t\t\t","description":""},{"code":"iM3W-07K0T\t\t\t \t\t\t","description":""}],"separator":"-","segments":[{"id":"c527514c-8e3c-4289-bbac-5330a47b3c04","label":"选配代号","options":[{"code":"0","description":"标准版（WiFi+BT+RS-485）"},{"code":"1","description":"标准版+4G模组"},{"code":"2","description":"标准版+MID电表"},{"code":"3","description":"标准版+MID电表+4G模组"},{"code":"8","description":"标准版+东鸿PTB（SDM630-EV V2）+4G+大彩屏+PLC"},{"code":"9","description":"标准版（WiFi+BT+RS-485）+PLC"},{"code":"A","description":"标准版+4G模组+PLC"},{"code":"B","description":"标准版+MID电表+PLC"},{"code":"C","description":"标准版+MID电表+4G模组+PLC"}]},{"id":"a24a400a-ed4e-4bcd-9ce6-e10f66a16f3e","label":"充电接口","options":[{"code":"E","description":"Type 2接口"}]},{"id":"00fc9bb8-2b4b-4c08-a20d-6132702b8e61","label":"枪线长度","options":[{"code":"0","description":"Case B"},{"code":"1","description":"带安全门的T2S Case B"},{"code":"5","description":"5米电缆"},{"code":"7","description":"7.5米电缆"}]},{"id":"04835a0e-4ef0-4e13-8bbf-294d12a92ece","label":"功率控制","options":[{"code":"0","description":"无外接负载平衡"},{"code":"1","description":"支持通过RS-485版APCC实现DLB"},{"code":"2","description":"支持通过485CT实现DLB"},{"code":"3","description":"支持通过智能电表实现Solar Logic + DLB"},{"code":"4","description":"支持Power Sharing"}]}]}',0);
INSERT INTO "appOptions" ("id","optionKey","value","sortOrder") VALUES('opt_972330ab4314405594894812bc7198f8','shipmentMode','By train',0);
INSERT INTO "appOptions" ("id","optionKey","value","sortOrder") VALUES('opt_3c7690ef9c1444b9adcc50507d93097b','shipmentMode','By sea',1);
INSERT INTO "appOptions" ("id","optionKey","value","sortOrder") VALUES('opt_3a6d7adee80745238553f0e327d408a5','shipmentMode','By air',2);
INSERT INTO "appOptions" ("id","optionKey","value","sortOrder") VALUES('opt_0c63a9ca192c4375965475d97765e3b8','shipmentMode','By road',3);
INSERT INTO "appOptions" ("id","optionKey","value","sortOrder") VALUES('opt_2fde630742844ebb9fef4698fc33bffd','incoterm','DDP',0);
INSERT INTO "appOptions" ("id","optionKey","value","sortOrder") VALUES('opt_9493428ba87a4f58899dcb2989b242ba','incoterm','DAP',1);
INSERT INTO "appOptions" ("id","optionKey","value","sortOrder") VALUES('opt_cdd2664c7ae344229391d53513712b93','incoterm','CIF',2);
INSERT INTO "appOptions" ("id","optionKey","value","sortOrder") VALUES('opt_b6e034c4df5e4c578f19d3c0850a1eaf','incoterm','FCA',3);
INSERT INTO "appOptions" ("id","optionKey","value","sortOrder") VALUES('opt_85f80a868d4e45c9aa82a1fa73814bba','incoterm','FOB',4);
INSERT INTO "appOptions" ("id","optionKey","value","sortOrder") VALUES('opt_6c0149a4e400473c87cea685672e19f1','incoterm','EXW',5);
INSERT INTO "appOptions" ("id","optionKey","value","sortOrder") VALUES('opt_60ce3963c3c34a9fb3aedf3333e68615','customerType','大分销商',0);
INSERT INTO "appOptions" ("id","optionKey","value","sortOrder") VALUES('opt_dcab8493abb04d8cac775704d77cd613','customerType','小分销商',1);
INSERT INTO "appOptions" ("id","optionKey","value","sortOrder") VALUES('opt_b00e189433f64d728ea63f9a4d9a89df','customerType','CPO',2);
INSERT INTO "appOptions" ("id","optionKey","value","sortOrder") VALUES('opt_b10df6f33211411486914b4d606fac7e','customerType','EPC',3);
INSERT INTO "appOptions" ("id","optionKey","value","sortOrder") VALUES('opt_85f294a5c1dd4613b85abf206701d9e4','customerType','安装商',4);
INSERT INTO "appOptions" ("id","optionKey","value","sortOrder") VALUES('opt_f9692d5baafb4dc0a80bb80b88f1d08d','customerType','自用',5);
INSERT INTO "appOptions" ("id","optionKey","value","sortOrder") VALUES('opt_d83be4c139aa43a3a481d18c66f488c4','customerType','贸易商',6);
INSERT INTO "appOptions" ("id","optionKey","value","sortOrder") VALUES('opt_6cfd6e064e41463e9d497bd5d2b33325','customerType','方案提供商',7);
INSERT INTO "appOptions" ("id","optionKey","value","sortOrder") VALUES('opt_66c3e87751164045b6c5221603c4eeb9','customerSource','谷歌官网',0);
INSERT INTO "appOptions" ("id","optionKey","value","sortOrder") VALUES('opt_7c38a5235f034cfd9a2298e2aa747a5c','customerSource','Weeyu店铺',1);
INSERT INTO "appOptions" ("id","optionKey","value","sortOrder") VALUES('opt_d1f596bda10e4f34b68bcc2e111984b5','customerSource','Injet Energy店铺',2);
INSERT INTO "appOptions" ("id","optionKey","value","sortOrder") VALUES('opt_09cc6ee1e0154ccba8d5563af3f4c210','customerSource','自主开发',3);
INSERT INTO "appOptions" ("id","optionKey","value","sortOrder") VALUES('opt_c5604287b5194fa88ec39a1ce112e285','customerSource','展会',4);
INSERT INTO "appOptions" ("id","optionKey","value","sortOrder") VALUES('opt_1c9a5360655b49068800bc720ab22771','customerSource','其他',5);
CREATE TABLE IF NOT EXISTS "piReviewEvents" (
  id TEXT PRIMARY KEY,
  piId TEXT NOT NULL REFERENCES pi(id) ON DELETE CASCADE,
  actorId TEXT NOT NULL REFERENCES users(id),
  action TEXT NOT NULL CHECK (action IN ('SUBMITTED', 'APPROVED', 'REJECTED')),
  note TEXT,
  createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "piReviewEvents" ("id","piId","actorId","action","note","createdAt") VALUES('evt_7f0f749c29f844acade5ff962bbb4cd7','pi_e8827827225146a6b9731afbe09f37fe','usr_877faa714bd04a93ac35f2de9a8f6794','SUBMITTED',NULL,'2026-05-19 12:57:49');
INSERT INTO "piReviewEvents" ("id","piId","actorId","action","note","createdAt") VALUES('evt_6ed1fa18e6b1410fb213a6dddb5828e3','pi_e8827827225146a6b9731afbe09f37fe','usr_877faa714bd04a93ac35f2de9a8f6794','APPROVED',NULL,'2026-05-19 12:58:50');
CREATE TABLE piNumberSequences (
  date TEXT PRIMARY KEY,
  lastSeq INTEGER NOT NULL
);
INSERT INTO "piNumberSequences" ("date","lastSeq") VALUES('2026-05-19',2);
INSERT INTO "piNumberSequences" ("date","lastSeq") VALUES('2026-05-31',7);
DELETE FROM sqlite_sequence;
INSERT INTO "sqlite_sequence" ("name","seq") VALUES('d1_migrations',6);
CREATE INDEX appOptions_key_idx ON appOptions(optionKey, sortOrder);
