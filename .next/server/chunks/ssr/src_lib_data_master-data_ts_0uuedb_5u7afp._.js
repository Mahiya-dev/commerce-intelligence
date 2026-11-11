module.exports=[33133,a=>{"use strict";var b=a.i(93033),c=a.i(9734),d=a.i(26683);class e extends Error{constructor(a){super(`Gagal memuat data (${a}). Coba muat ulang halaman.`),this.name="DataAccessError"}}class f extends Error{constructor(a){super(`Peran minimal ${a} diperlukan.`),this.name="AuthorizationError"}}function g(a,b){if(!(0,c.L)(a.role,b))throw new f(b)}async function h(a,b){try{return await b()}catch(b){if(b instanceof f)throw b;throw d.f.error("data.query_failed",{operation:a,error:b}),new e(a)}}let i=a=>a?a.toISOString():null;async function j(a){g(a,"viewer");let c=a.organization.id;return h("summary",async()=>{let a=await (0,b.p)(`SELECT
         (SELECT COUNT(*) FROM products WHERE organization_id = ?) AS products,
         (SELECT COUNT(*) FROM product_variants WHERE organization_id = ?) AS variants,
         (SELECT COUNT(*) FROM channel_listings WHERE organization_id = ?) AS listings,
         (SELECT COUNT(*) FROM channel_listings WHERE organization_id = ? AND variant_id IS NULL) AS unmapped,
         (SELECT MAX(updated_at) FROM products WHERE organization_id = ?) AS last_update`,[c,c,c,c,c]);return{products:Number(a?.products??0),variants:Number(a?.variants??0),listings:Number(a?.listings??0),unmappedListings:Number(a?.unmapped??0),lastMasterDataUpdate:i(a?.last_update??null)}})}async function k(a,c){g(a,"viewer"),c.includeCogs&&g(a,"analyst");let d=a.organization.id;return h("products.list",async()=>{let a=await (0,b.J)(`SELECT id, code, name, category, product_type, status, is_demo, updated_at
         FROM products WHERE organization_id = ? ORDER BY code`,[d]),e=await (0,b.J)(`SELECT id, product_id, sku, name, size_value, size_unit, standard_cogs, status
         FROM product_variants WHERE organization_id = ? ORDER BY sku`,[d]),f=new Map;for(let a of e){let b=f.get(a.product_id)??[];b.push({id:a.id,sku:a.sku,name:a.name,sizeValue:null===a.size_value?null:Number(a.size_value),sizeUnit:a.size_unit,standardCogs:c.includeCogs&&null!==a.standard_cogs?Number(a.standard_cogs):null,status:a.status}),f.set(a.product_id,b)}return a.map(a=>({id:a.id,code:a.code,name:a.name,category:a.category,productType:a.product_type,status:a.status,isDemo:1===a.is_demo,updatedAt:a.updated_at.toISOString(),variants:f.get(a.id)??[]}))})}async function l(a){return g(a,"viewer"),h("listings.list",async()=>(await (0,b.J)(`SELECT l.id, c.name AS channel_name, l.external_product_id, l.external_sku_id, l.listing_name,
              l.units_per_listing, v.sku, l.updated_at
         FROM channel_listings l
         JOIN channels c ON c.id = l.channel_id
         LEFT JOIN product_variants v ON v.organization_id = l.organization_id AND v.id = l.variant_id
        WHERE l.organization_id = ?
        ORDER BY c.sort_order, l.listing_name`,[a.organization.id])).map(a=>({id:a.id,channelName:a.channel_name,externalProductId:a.external_product_id,externalSkuId:""===a.external_sku_id?null:a.external_sku_id,listingName:a.listing_name,unitsPerListing:a.units_per_listing,mappedSku:a.sku,updatedAt:a.updated_at.toISOString()})))}async function m(a){return g(a,"admin"),h("members.list",async()=>(await (0,b.J)(`SELECT m.user_id, u.email, u.full_name, m.role, m.status, u.status AS user_status, u.last_login_at, m.created_at
         FROM organization_members m JOIN users u ON u.id = m.user_id
        WHERE m.organization_id = ?
        ORDER BY FIELD(m.role, 'owner', 'admin', 'analyst', 'viewer'), m.created_at`,[a.organization.id])).map(a=>({userId:a.user_id,email:a.email,fullName:a.full_name,role:a.role,status:a.status,userStatus:a.user_status,lastLoginAt:i(a.last_login_at),createdAt:a.created_at.toISOString()})))}async function n(a,c=50){g(a,"admin");let d=a.organization.id,e=Math.min(Math.max(Math.trunc(c),1),200);return h("audit.list",async()=>(await (0,b.J)(`SELECT a.id, a.action, a.entity_type, a.entity_id, COALESCE(u.full_name, u.email) AS actor,
              a.ip_address, a.created_at
         FROM audit_logs a
         LEFT JOIN users u ON u.id = a.actor_user_id
        WHERE a.organization_id = ?
           OR (a.organization_id IS NULL
               AND a.actor_user_id IN (SELECT user_id FROM organization_members WHERE organization_id = ?))
        ORDER BY a.created_at DESC, a.id DESC
        LIMIT ${e}`,[d,d])).map(a=>({id:String(a.id),action:a.action,entityType:a.entity_type,entityId:a.entity_id,actor:a.actor,ipAddress:a.ip_address,createdAt:a.created_at.toISOString()})))}a.s(["X",0,j,"W",0,n,"b",0,l,"m",0,m,"H",0,k])}];

//# sourceMappingURL=src_lib_data_master-data_ts_0uuedb_5u7afp._.js.map