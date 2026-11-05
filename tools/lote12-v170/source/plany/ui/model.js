(function (root) {
  'use strict';
  var D=typeof module!=='undefined'&&module.exports?require('../dimensions'):root.PlanyDimensions;
  var PanelModel=typeof module!=='undefined'&&module.exports?require('./panel'):root.MyDinaPanel;
  var MATERIAL_NAME_LIMIT=PanelModel.MATERIAL_NAME_LIMIT,materialLength=PanelModel.materialLength;
  var Glass=typeof module!=='undefined'&&module.exports?require('../glass'):root.PlanyGlass;
  var defaults = {name:'Novo Módulo',component_kind:'',volume_bound:false,reference_trims:{},module_family:'cabinet',width:800,height:720,depth:450,thickness:15,back:true,back_thickness:6,
    base_type:'under',top_type:'full',top_join:'over',rail_width:70,bottom_type:'full',bottom_rail_width:70,back_type:'applied',back_setback:10,back_groove_depth:5,back_panel_type:'full',back_rail_width:70,
    material:'Branco TX',back_material:'Branco TX',apparent_material:'',hidden_material:'Retalho',layout:{id:'root'},opening_layouts:[],opening_sequence:0,fronts:[],claddings:[],trims:[],accessories:[],piece_settings:{},excluded_pieces:[],joint_banding:false};
  function clone(v) { return JSON.parse(JSON.stringify(v)); }
  // Deliberately small arithmetic grammar. Never executes JavaScript or accepts names.
  function calculate(text, original) {
    var source=String(text).trim().replace(/×/g,'*').replace(/÷/g,'/').replace(/,/g,'.');
    if(!source||source.length>256||/[^\d\s.+*/()\-]/.test(source))throw new Error('Informe uma conta válida.');
    if(/^[+*/-]/.test(source)){
      if(!Number.isFinite(Number(original)))throw new Error('Informe primeiro o valor de referência.');
      source='('+Number(original)+')'+source;
    }
    var index=0,tokens=0,depth=0;
    function space(){while(/\s/.test(source.charAt(index))&&index<source.length)index++;}
    function atom(){
      space();if(++tokens>128||++depth>24)throw new Error('Conta muito extensa.');
      var value,c=source.charAt(index);
      if(c==='+'||c==='-'){index++;value=(c==='-'?-1:1)*atom();}
      else if(c==='('){index++;value=sum();space();if(source.charAt(index++)!==')')throw new Error('Feche os parênteses.');}
      else {var match=source.slice(index).match(/^(?:\d+(?:\.\d*)?|\.\d+)/);if(!match)throw new Error('Informe uma conta válida.');index+=match[0].length;value=Number(match[0]);}
      depth--;return value;
    }
    function product(){var value=atom();for(;;){space();var c=source.charAt(index);if(c!=='*'&&c!=='/')break;index++;var right=atom();if(c==='/'&&right===0)throw new Error('Não é possível dividir por zero.');value=c==='*'?value*right:value/right;}return value;}
    function sum(){var value=product();for(;;){space();var c=source.charAt(index);if(c!=='+'&&c!=='-')break;index++;var right=product();value=c==='+'?value+right:value-right;}return value;}
    var result=sum();space();if(index!==source.length||!Number.isFinite(result))throw new Error('Informe uma conta válida e finita.');
    return Number(result.toPrecision(14));
  }
  function number(v,label,min,max) {
    var n;try{n=D.parse(v);if(!D.scalar(label))n=D.mm(n);}catch(error){throw new Error(label+': informe um número válido.');}
    if(!Number.isFinite(n)||n<min||n>max)throw new Error(label+': use um valor entre '+min+' e '+max+'.');return n;
  }
  function cleanMm(value){return D.mm(value);}
  function normalizeRule(raw){
    if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new Error('O comportamento da peça é inválido.');
    var result={};
    ['width','depth','height'].forEach(function(key){
      var axis=Object.prototype.hasOwnProperty.call(raw,key)?raw[key]:{follow:false,anchor:'start'};
      if(!axis||typeof axis.follow!=='boolean'||['start','center','end'].indexOf(axis.anchor)<0)throw new Error('Escolha medidas e pontos de referência válidos para a peça.');
      result[key]={follow:axis.follow,anchor:axis.anchor};
    });return result;
  }
  function materialName(value,fallback){
    var text=String(value===undefined||value===null?'':value).trim();
    if(!text)text=fallback||'Branco TX';
    if(materialLength(text)>MATERIAL_NAME_LIMIT)throw new Error('Use até '+MATERIAL_NAME_LIMIT+' caracteres no material.');
    if(text==='SOBRA')text='Retalho';
    var key=text.toLocaleLowerCase('pt-BR');return key==='mdf'||key==='mdf branco'?'Branco TX':text;
  }
  function glassMaterialName(color){
    return {clear:'Vidro Incolor',smoke:'Vidro Fumê',bronze:'Vidro Bronze',green:'Vidro Verde',mirror:'Espelho'}[color]||'Vidro Incolor';
  }
  function normalizeNode(node,id,depth) {
    if (!node||typeof node!=='object'||Array.isArray(node)) throw new Error('Estrutura de vãos inválida.');
    if (depth>16) throw new Error('Use no máximo 16 níveis de divisões nesta versão.');
    var r={id:id};
    if (node.split) {
      if (['horizontal','vertical'].indexOf(node.split)<0) throw new Error('Tipo de divisão inválido.');
      var ratio=node.ratio===undefined?0.5:Number(node.ratio);
      if (!Number.isFinite(ratio)||ratio<0||ratio>1) throw new Error('Proporção inválida.');
      r.split=node.split;r.ratio=ratio;r.position_mode=node.position_mode||'ratio';
      if(node.insertion_batch){if(!/^[a-zA-Z0-9_-]{1,48}$/.test(node.insertion_batch))throw new Error('Identificação da inserção inválida.');r.insertion_batch=node.insertion_batch;}
      if(node.keep_divider_proportions!==undefined){if(typeof node.keep_divider_proportions!=='boolean')throw new Error('Proporção das divisórias inválida.');r.keep_divider_proportions=node.keep_divider_proportions;}
      if(['ratio','start','end'].indexOf(r.position_mode)<0)throw new Error('Referência de posição inválida.');
      if(r.position_mode!=='ratio')r.distance=number(node.distance===undefined?100:node.distance,'Distância do vão',0,4000);
      r.first=normalizeNode(node.first,id+'/a',depth+1);r.second=normalizeNode(node.second,id+'/b',depth+1);
    }
    return r;
  }

  function normalizeAdvancedFront(f,raw,p){
    function value(key,fallback,label,min,max,obj){var source=obj||raw;return number(source[key]===undefined?fallback:source[key],label,min,max);}
    if(f.kind==='drawers'){
      if(raw.drawer_type==='spice'){
        f.drawer_type='spice';f.spice_levels=value('spice_levels',2,'Níveis do tempereiro',1,2);
        if(f.spice_levels!==Math.floor(f.spice_levels))throw new Error('Quantidade de níveis inválida.');
        f.spice_thickness=value('spice_thickness',15,'Espessura do tempereiro',6,40);
        f.spice_front_height=value('spice_front_height',0,'Altura da contrafrente',0,4000);f.spice_front_top=value('spice_front_top',20,'Recuo superior da contrafrente',0,1000);
        f.spice_second_height=value('spice_second_height',0,'Altura do segundo nível',0,4000);
        f.spice_runners=raw.spice_runners||'per_level';
        if(['per_level','diagonal','left','right'].indexOf(f.spice_runners)<0)throw new Error('Configuração das corrediças do tempereiro inválida.');
        if(f.spice_levels===1&&f.spice_runners!=='per_level')throw new Error('A disposição escolhida precisa dos dois níveis do tempereiro.');
        if(f.runner!=='telescopic')throw new Error('O tempereiro usa apenas corrediças telescópicas.');
        f.count=1;f.front_height_linked=false;f.hardware_layout_version=1;
      }
      if(p.module_family==='functional'&&p.component_kind==='drawer'){
        ['include_front','include_runners'].forEach(function(key){f[key]=raw[key]===undefined?true:raw[key];if(typeof f[key]!=='boolean')throw new Error('Opção da gaveta avulsa inválida.');});
        ['left','right','top','bottom'].forEach(function(side){f['advance_'+side]=value('advance_'+side,0,'Avanço da frente',-1000,4000);});
        f.loose_drawer=true;f.count=1;f.box_depth=p.depth;f.box_height=p.height;f.box_depth_auto=false;f.hardware_layout_version=1;f.front_height_linked=false;
      }
    }else if(f.door_type==='sliding'){
      f.sliding_version=1;f.track_count=value('track_count',f.count===1?1:2,'Quantidade de vias',1,8);
      if(f.track_count!==Math.floor(f.track_count))throw new Error('A quantidade de vias deve ser inteira.');
      f.overlap=value('overlap',30,'Transpasse',0,1000);f.track_height=value('track_height',15,'Altura do trilho',2,100);
      f.sliding_limit_left=value('sliding_limit_left',0,'Limite esquerdo',-10000,10000);
      f.sliding_limit_right=raw.sliding_limit_right===undefined||raw.sliding_limit_right===null||raw.sliding_limit_right===''?null:value('sliding_limit_right',p.width,'Limite direito',-10000,20000);
      var leaves=raw.sliding_leaves||[];if(!Array.isArray(leaves)||leaves.length>4)throw new Error('Configuração das folhas inválida.');
      f.sliding_leaves=Array.from({length:f.count},function(_,i){
        var leaf=leaves[i]||{},type=leaf.type||'mdf';if(['mdf','profile_mdf','profile_glass','profile_mirror'].indexOf(type)<0)throw new Error('Material da folha inválido.');
        var track=value('track',i%f.track_count,'Via da folha',0,f.track_count-1,leaf);if(track!==Math.floor(track))throw new Error('A via deve ser inteira.');
        var data={type:type,track:track,material:materialName(leaf.material||f.material,p.material),
          width:value('width',0,'Largura manual da folha',0,10000,leaf),weight:value('weight',1,'Proporção da folha',.001,10000,leaf),
          thickness:value('thickness',type==='profile_glass'?6:type==='profile_mirror'?4:f.thickness,'Espessura da folha',3,40,leaf),
          profile_width:value('profile_width',20,'Largura do perfil',5,100,leaf),profile_depth:value('profile_depth',25,'Profundidade do perfil',5,100,leaf),
          profile_wall:value('profile_wall',1.5,'Espessura do perfil',.5,10,leaf),engagement:value('engagement',6,'Encaixe do perfil',0,50,leaf),finish:materialName(leaf.finish||'Alumínio natural')};
        if(type!=='mdf'&&(data.engagement>=data.profile_width||data.profile_depth<data.thickness+2*data.profile_wall))throw new Error('O perfil não comporta a espessura ou o encaixe da folha.');
        return data;
      });
    }
    return f;
  }
  function advancedFront(p,f){return f.drawer_type==='spice'||p.module_family==='functional'&&p.component_kind==='drawer'||f.sliding_version===1;}
  function componentBoard(role,name,origin,size,axis,material,edges){var part=panel(role,name,origin,size,axis,material);if(edges)part.default_edges=edges;return part;}
  function componentFrontBounds(p,f,r){
    if(f.fit!=='overlay')return [r.x+f.gap_left,r.z+f.gap_bottom,r.x+r.width-f.gap_right,r.z+r.height-f.gap_top];
    if(p.module_family!=='cabinet')return [f.gap_left,f.gap_bottom,p.width-f.gap_right,p.height-f.gap_top];
    return [Math.abs(r.x-thickness(p,'left'))<1e-7?f.gap_left:r.x-r.edges[0]/2+f.gap_left/2,
      Math.abs(r.z-thickness(p,p.bottom_type==='rails'?'bottom:front':'bottom'))<1e-7?f.gap_bottom:r.z-r.edges[2]/2+f.gap_bottom/2,
      Math.abs(r.x+r.width-(p.width-thickness(p,'right')))<1e-7?p.width-f.gap_right:r.x+r.width+r.edges[1]/2-f.gap_right/2,
      Math.abs(r.z+r.height-(p.height-thickness(p,p.top_type==='full'?'top':'rail:front')))<1e-7?p.height-f.gap_top:r.z+r.height+r.edges[3]/2-f.gap_top/2];
  }
  function componentPanels(p,f,r,depth){
    var prefix='front:'+f.id+':0',material=f.box_material||p.material;
    if(p.module_family==='functional'&&p.component_kind==='drawer'){
      var w=p.width,d=p.depth,h=p.height,t=p.thickness,bt=p.back_thickness;
      if(w-2*t<50||d-2*t<50||h-bt<20)throw new Error('A caixa da gaveta avulsa ficou pequena para as espessuras.');
      var parts=[componentBoard(prefix+':bottom','Fundo da gaveta',[0,0,0],[w,d,bt],2,f.box_material||p.back_material),
        componentBoard(prefix+':left','Lateral esquerda da gaveta',[0,0,bt],[t,d,h-bt],0,material),componentBoard(prefix+':right','Lateral direita da gaveta',[w-t,0,bt],[t,d,h-bt],0,material),
        componentBoard(prefix+':inner','Contrafrente da gaveta',[t,0,bt],[w-2*t,t,h-bt],1,material),componentBoard(prefix+':rear','Traseira da gaveta',[t,d-t,bt],[w-2*t,t,h-bt],1,material)];
      if(f.include_front){if(w+f.advance_left+f.advance_right<50||h+f.advance_top+f.advance_bottom<50)throw new Error('Os avanços deixam a frente sem dimensões úteis.');parts.push(componentBoard(prefix+':face','Frente da gaveta',[-f.advance_left,-f.thickness,-f.advance_bottom],[w+f.advance_left+f.advance_right,f.thickness,h+f.advance_top+f.advance_bottom],1,f.material));}
      return parts;
    }
    if(f.drawer_type==='spice'){
      var t=f.spice_thickness,w=r.width-2*f.slide_clearance,d=f.box_depth,x=r.x+f.slide_clearance,y=drawerBoxStart(f),z=r.z+10,frontTop=f.spice_front_height>0?z+f.spice_front_height:r.z+r.height-f.spice_front_top;
      if(w-2*t<25||d-2*t<50||y+d>depth-f.rear_clearance+1e-6)throw new Error('O tempereiro não cabe na largura ou profundidade disponível.');
      var bottoms=[z];if(f.spice_levels===2){var upper=f.spice_second_height>0?r.z+f.spice_second_height:Math.min(z+(frontTop-z)/2,frontTop-(t+20+60+10));if(upper<z+t+20+60+10-1e-6)throw new Error('Os dois níveis do tempereiro não cabem sem sobrepor as laterais.');bottoms.push(upper);}
      var rearTop=bottoms[bottoms.length-1]+t+20+60+5;if(rearTop>=frontTop||frontTop>r.z+r.height)throw new Error('A contrafrente precisa ultrapassar a contraposterior e caber no vão.');
      var pieces=[componentBoard(prefix+':inner','Contrafrente contínua do tempereiro',[x,y,z],[w,t,frontTop-z],1,material),componentBoard(prefix+':rear','Contraposterior contínua do tempereiro',[x,y+d-t,z],[w,t,rearTop-z],1,material)];
      bottoms.forEach(function(bottom,i){var key=i===0?prefix:prefix+':level'+(i+1);pieces.push(componentBoard(key+':bottom','Fundo do tempereiro '+(i+1),[x,y+t,bottom],[w,d-2*t,t],2,material,['u_min','u_max']));pieces.push(componentBoard(key+':left','Lateral esquerda do tempereiro '+(i+1),[x,y+t,bottom+t+20],[t,d-2*t,60],0,material,['v_min','v_max']));pieces.push(componentBoard(key+':right','Lateral direita do tempereiro '+(i+1),[x+w-t,y+t,bottom+t+20],[t,d-2*t,60],0,material,['v_min','v_max']));});
      var bounds=componentFrontBounds(p,f,r);pieces.push(componentBoard(prefix+':face','Frente do tempereiro',[bounds[0],f.fit==='overlay'?-f.thickness:f.face_recess,bounds[1]],[bounds[2]-bounds[0],f.thickness,bounds[3]-bounds[1]],1,f.material));return pieces;
    }
    var bounds=componentFrontBounds(p,f,r),span=bounds[2]-bounds[0],leaves=f.sliding_leaves,total=span+f.overlap*(f.count-1),fixed=0,weight=0,auto=0;
    leaves.forEach(function(leaf){if(leaf.width>0)fixed+=leaf.width;else{weight+=leaf.weight;auto++;}});var remaining=total-fixed;
    if(!auto&&Math.abs(remaining)>.05||auto&&remaining<50*auto)throw new Error('As larguras manuais não atendem ao transpasse e ao espaço disponível.');
    var widths=leaves.map(function(leaf){return leaf.width>0?leaf.width:remaining*leaf.weight/weight;});
    if(widths.some(function(w){return w<50||w<=f.overlap;})||bounds[3]-bounds[1]-2*f.track_height<50)throw new Error('O transpasse ou as folgas deixam as folhas pequenas demais.');
    var pitch=Math.max.apply(null,leaves.map(function(leaf){return leaf.type==='mdf'?leaf.thickness:leaf.profile_depth;}))+6;
    var limitLeft=bounds[0]+f.sliding_limit_left,limitRight=f.sliding_limit_right===null?bounds[2]:bounds[0]+f.sliding_limit_right;
    if(limitRight-limitLeft<Math.max.apply(null,widths))throw new Error('Os limites não comportam as folhas de correr.');
    var x=bounds[0],result=[];
    leaves.forEach(function(leaf,i){var width=widths[i],outer=leaf.type==='mdf'?leaf.thickness:leaf.profile_depth,y=f.fit==='overlay'?-f.track_count*pitch-2+leaf.track*pitch:leaf.track*pitch;
      if(f.fit==='inset'&&y+outer>depth)throw new Error('As vias da porta embutida ultrapassam a profundidade do vão.');
      if(x<limitLeft-1e-5||x+width>limitRight+1e-5)throw new Error('A folha fechada ultrapassa os limites configurados.');
      var border=leaf.type==='mdf'?0:leaf.profile_width-leaf.engagement,material=leaf.type==='profile_mirror'?'Espelho':leaf.type==='profile_glass'?(leaf.material.indexOf('Vidro')===0?leaf.material:'Vidro Incolor'):leaf.material;
      var part=componentBoard('front:'+f.id+':'+i,'Porta de correr '+(i+1),[x+border,y+(outer-leaf.thickness)/2,bounds[1]+f.track_height+border],[width-2*border,leaf.thickness,bounds[3]-bounds[1]-2*f.track_height-2*border],1,material);
      if(part.size[0]<10||part.size[2]<10||leaf.type!=='mdf'&&(width<=2*leaf.profile_width||bounds[3]-bounds[1]-2*f.track_height<=2*leaf.profile_width))throw new Error('O perfil deixa a folha sem preenchimento útil.');
      if(['profile_glass','profile_mirror'].indexOf(leaf.type)>=0){part.default_construction_type='glass';if(leaf.type==='profile_mirror')part.default_glass_model='espelho';}
      part.sliding={index:i,track:leaf.track,x:x,y:y,z:bounds[1]+f.track_height,width:width,height:bounds[3]-bounds[1]-2*f.track_height,depth:outer,limit_left:limitLeft,limit_right:limitRight,pitch:pitch,rail_height:f.track_height,rail_z:bounds[1],leaf:leaf};result.push(part);x+=width-f.overlap;
    });
    result.forEach(function(a,i){result.slice(i+1).forEach(function(b){var x=a.sliding,y=b.sliding;if(x.track===y.track&&Math.min(x.x+x.width,y.x+y.width)>Math.max(x.x,y.x)+1e-5)throw new Error('As folhas se sobrepõem na mesma via. Escolha outra distribuição.');});});return result;
  }

  function normalizeFront(raw,p) {
    if (!raw||typeof raw!=='object') throw new Error('Frente inválida.');
    var f={id:raw.id,kind:raw.kind||'door',nodes:raw.nodes,fit:raw.fit||'overlay',material:materialName(raw.material,p.material)};
    if (typeof f.id!=='string'||!/^[a-zA-Z0-9_-]{1,40}$/.test(f.id)) throw new Error('Identificação da frente inválida.');
    if (['door','drawers'].indexOf(f.kind)<0||['overlay','inset'].indexOf(f.fit)<0) throw new Error('Tipo de frente inválido.');
    if (!Array.isArray(f.nodes)||!f.nodes.length||f.nodes.length>128||!f.nodes.every(function(n){return typeof n==='string';})) throw new Error('Escolha os vãos da frente.');
    f.side=raw.side||'front';if(['front','rear'].indexOf(f.side)<0)throw new Error('Lado de inserção inválido.');
    f.runner=raw.runner||'telescopic';f.visibility=raw.visibility||'external';
    if(['telescopic','concealed','custom'].indexOf(f.runner)<0||['external','internal'].indexOf(f.visibility)<0)throw new Error('Configuração da gaveta inválida.');
    f.recess=number(raw.recess===undefined?22:raw.recess,'Recuo da gaveta interna',0,300);
    f.face_recess=number(raw.face_recess===undefined?(f.kind==='drawers'?5:0):raw.face_recess,'Recuo frontal',0,1500);
    f.door_type=raw.door_type||'hinged';
    f.door_opening=raw.door_opening||'left';
    f.lift_system=raw.lift_system||'gas';
    if(['gas','mechanical'].indexOf(f.lift_system)<0)throw new Error('Sistema de basculante inválido.');
    if(['hinged','lift','sliding'].indexOf(f.door_type)<0)throw new Error('Tipo de porta inválido.');
    if(['left','right','double','top','bottom'].indexOf(f.door_opening)<0)throw new Error('Abertura da porta inválida.');
    f.nodes=[].concat.apply([],f.nodes.map(function(id){return id.split('|');})).filter(function(n,i,a){return a.indexOf(n)===i;});
    if(f.nodes.length>128)throw new Error('Escolha os vãos da frente.');
    f.material=materialName(f.material,p.material);
    if (materialLength(f.material)>MATERIAL_NAME_LIMIT) throw new Error('Nome de material muito longo.');
    f.count=number(raw.count===undefined?1:raw.count,'Quantidade',1,f.kind==='door'?(f.door_type==='sliding'?4:3):8);
    if (f.count!==Math.floor(f.count)) throw new Error('Quantidade deve ser inteira.');
    [['gap',3,0,Infinity,'Folga entre frentes'],['thickness',p.thickness,6,40,'Espessura da frente'],
      ['slide_clearance',Number(raw.hardware_layout_version)===1?14:13,0,50,'Folga de cada corrediça'],['box_height',120,40,4000,'Altura da caixa da gaveta'],
      ['box_depth',350,100,1500,'Profundidade da caixa da gaveta']].forEach(function(r){f[r[0]]=number(raw[r[0]]===undefined?r[1]:raw[r[0]],r[4],r[2],r[3]);});
    if(f.kind==='drawers'){
      f.box_material=raw.box_material?materialName(raw.box_material,p.material):'';
      f.box_depth_auto=raw.box_depth_auto!==false;
      if(raw.box_depth_auto!==undefined&&typeof raw.box_depth_auto!=='boolean')throw new Error('Ajuste automático da profundidade inválido.');
      if(materialLength(f.box_material)>MATERIAL_NAME_LIMIT)throw new Error('Nome do MDF da caixa muito longo.');
      f.rear_clearance=number(raw.rear_clearance===undefined?10:raw.rear_clearance,'Folga traseira',Number(raw.rear_clearance)===2?2:10,1500);
      f.hardware_layout_version=raw.hardware_layout_version===undefined?0:Number(raw.hardware_layout_version);
      if([0,1].indexOf(f.hardware_layout_version)<0)throw new Error('Configuração da corrediça inválida.');
      f.front_height_linked=raw.front_height_linked===undefined?f.hardware_layout_version===1:raw.front_height_linked;
      if(typeof f.front_height_linked!=='boolean')throw new Error('Vínculo da altura da gaveta inválido.');
      [['runner_height',44,20,80,'Altura da corrediça'],['runner_drop',10,0,40,'Avanço da corrediça abaixo do fundo'],
        ['base_clearance',10,0,80,'Folga da primeira gaveta sobre a base'],['front_projection',15,0,80,'Frente abaixo do fundo']].forEach(function(r){
        var fallback=r[0]==='base_clearance'&&f.runner==='telescopic'&&f.hardware_layout_version===1?f.runner_drop:r[1];
        f[r[0]]=number(raw[r[0]]===undefined?fallback:raw[r[0]],r[4],r[2],r[3]);
      });
      if(f.runner==='telescopic'&&f.hardware_layout_version===1&&f.slide_clearance<=0)throw new Error('A corrediça telescópica precisa de folga lateral maior que zero.');
      if(f.runner==='telescopic'&&f.hardware_layout_version===1&&f.base_clearance!==f.runner_drop)throw new Error('A primeira corrediça deve ficar apoiada na base. Iguale a folga da primeira caixa ao avanço da corrediça.');
      if(f.runner==='telescopic'&&f.hardware_layout_version===1&&f.runner_height<=2*f.runner_drop)throw new Error('A altura da corrediça precisa ser maior que os espaços acima e abaixo do trilho móvel.');
      f.box_height_difference=number(raw.box_height_difference===undefined?0:raw.box_height_difference,'Diferença de altura da caixa',0,500);
    }
    [['gap_left','Folga esquerda'],['gap_right','Folga direita'],['gap_bottom','Folga inferior'],['gap_top','Folga superior']].forEach(function(r){
      f[r[0]]=number(raw[r[0]]===undefined?f.gap:raw[r[0]],r[1],-Infinity,Infinity);
    });
    return normalizeAdvancedFront(f,raw,p);
  }
  function hasSideCladdings(p){
    return (p.claddings||[]).some(function(value){return value.side==='left'||value.side==='right';});
  }
  function baseboardSideSetbacks(p,t){
    return t.cover_cladding!==false&&hasSideCladdings(p)?[0,0]:[t.setback_left||0,t.setback_right||0];
  }
  function normalizeTrim(raw,p){
    if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new Error('Rodapé/rodateto inválido.');
    if(p.module_family==='baseboard'||p.module_family==='functional'&&p.component_kind==='crown'&&!p.volume_bound)raw=Object.assign({},raw,{height:p.height,thickness:p.thickness,setback:0,setback_back:0,setback_left:0,setback_right:0,cover_cladding:false});
    var t={kind:raw.kind||'baseboard',material:materialName(raw.material,p.material)};
    if(['baseboard','crown'].indexOf(t.kind)<0)throw new Error('Tipo de acabamento inválido.');
    t.height=number(raw.height===undefined?100:raw.height,'Altura do acabamento',20,1000);
    t.thickness=number(raw.thickness===undefined?p.thickness:raw.thickness,'Espessura do acabamento',6,40);
    t.setback=number(raw.setback===undefined?(t.kind==='baseboard'?50:0):raw.setback,'Recuo do acabamento',0,500);
    if(!t.material)t.material=p.material;
    t.material=materialName(t.material,p.material);
    if(materialLength(t.material)>MATERIAL_NAME_LIMIT)throw new Error('Nome do material muito longo.');
    if(raw.cover_cladding!==undefined){
      if(typeof raw.cover_cladding!=='boolean')throw new Error('Cobertura pelo tamponamento inválida.');
      t.cover_cladding=raw.cover_cladding;
    }
    if(t.kind==='baseboard'&&raw.structure_version===1){
      t.structure_version=1;
      t.foot_height=number(raw.foot_height===undefined?15:raw.foot_height,'Altura da sapata',1,t.height-10);
      t.setback_back=number(raw.setback_back===undefined?0:raw.setback_back,'Recuo traseiro',0,500);
      t.setback_left=number(raw.setback_left===undefined?0:raw.setback_left,'Recuo esquerdo',0,500);
      t.setback_right=number(raw.setback_right===undefined?0:raw.setback_right,'Recuo direito',0,500);
      t.max_opening=number(raw.max_opening===undefined?600:raw.max_opening,'Largura máxima entre vãos',100,4000);
      t.frame_material=materialName(raw.frame_material,p.hidden_material);
      if(materialLength(t.frame_material)>MATERIAL_NAME_LIMIT)throw new Error('Nome do material muito longo.');
      ['left','right','back'].forEach(function(side){
        if(raw['finish_'+side]!==undefined&&typeof raw['finish_'+side]!=='boolean')throw new Error('Acabamento do rodapé inválido.');
        t['finish_'+side]=raw['finish_'+side]===true;
      });
      var setbacks=baseboardSideSetbacks(p,t),side=setbacks[0]+setbacks[1]+(Number(t.finish_left)+Number(t.finish_right))*t.thickness;
      if(p.width-side<=3*t.thickness)throw new Error('Recuos laterais deixam o rodapé sem espaço.');
      if(p.depth-t.setback-t.setback_back-(t.finish_back?t.thickness:0)<=3*t.thickness)throw new Error('Recuos frontal e traseiro deixam o rodapé sem espaço.');
    }else if(t.kind==='crown'){
      ['left','right','back'].forEach(function(side){
        var flag='crown_'+side;
        if(raw[flag]!==undefined&&typeof raw[flag]!=='boolean')throw new Error('Lado do rodateto inválido.');
        t[flag]=raw[flag]===true;
        t['setback_'+side]=number(raw['setback_'+side]===undefined?0:raw['setback_'+side],'Recuo '+side+' do rodateto',0,500);
      });
      var left=t.crown_left?t.setback_left:0,right=t.crown_right?t.setback_right:0,pt=t.thickness;
      if(t.crown_left&&left+pt>=p.width||t.crown_right&&right+pt>=p.width||t.crown_left&&t.crown_right&&left+right+2*pt>=p.width)throw new Error('Recuos laterais deixam o rodateto sem espaço.');
      var rear=t.crown_back?t.setback_back+pt:0;
      if(t.setback+pt>=p.depth-rear)throw new Error('Recuos frontal e traseiro deixam o rodateto sem espaço.');
    }
    return t;
  }
  function normalizeAccessory(raw){
    if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new Error('Acessório inválido.');
    var families=['wirework','outlets','cable_grommet','hardware','casters','glides','feet','hangers','supports','other'];
    var a={id:String(raw.id||''),family:raw.family||'other',name:String(raw.name||'').trim()};
    if(!/^[a-zA-Z0-9_-]{1,40}$/.test(a.id))throw new Error('Identificação do acessório inválida.');
    if(families.indexOf(a.family)<0)throw new Error('Família de acessório inválida.');
    if(!a.name||a.name.length>80)throw new Error('Informe uma descrição do acessório com até 80 caracteres.');
    a.quantity=number(raw.quantity===undefined?1:raw.quantity,'Quantidade do acessório',1,999);
    if(a.quantity!==Math.floor(a.quantity))throw new Error('Quantidade do acessório deve ser inteira.');
    return a;
  }
  function trimPanels(p){
    return (p.trims||[]).reduce(function(result,t){
      var role='trim:'+t.kind,name=t.kind==='baseboard'?'Rodapé':'Rodateto',pt=thickness(p,role,t.thickness);
      if(t.kind==='baseboard'&&t.structure_version===1){
        var setbacks=baseboardSideSetbacks(p,t),h=t.height-t.foot_height,f=t.setback,b=t.setback_back,left=setbacks[0],right=setbacks[1];
        var span=p.width-left-right,frameLeft=left+(t.finish_left?pt:0),frameRight=p.width-right-(t.finish_right?pt:0),frameSpan=frameRight-frameLeft;
        var backY=p.depth-b-(t.finish_back?pt:0),inside=frameSpan-2*pt,depth=backY-f,gaps=Math.max(1,Math.ceil(inside/t.max_opening)),frame=t.frame_material;
        if(frameSpan<=3*pt||depth<=3*pt)throw new Error('Recuos deixam o rodapé sem espaço.');
        result.push(panel(role,'Frontal do rodapé',[left,f,-h],[span,pt,h],1,t.material));
        if(t.finish_left)result.push(panel(role+':left','Acabamento lateral esquerdo do rodapé',[left,f+pt,-h],[pt,depth-pt,h],0,t.material));
        if(t.finish_right)result.push(panel(role+':right','Acabamento lateral direito do rodapé',[p.width-right-pt,f+pt,-h],[pt,depth-pt,h],0,t.material));
        if(t.finish_back)result.push(panel(role+':back','Acabamento traseiro do rodapé',[left,backY,-h],[span,pt,h],1,t.material));
        result.push(panel(role+':frame:front','Rodapé estrutural frontal',[frameLeft,f+pt,-h],[frameSpan,pt,h],1,frame));
        result.push(panel(role+':frame:back','Rodapé estrutural traseiro',[frameLeft,backY-pt,-h],[frameSpan,pt,h],1,frame));
        var railLength=depth-3*pt;
        var uprightHeight=h,flatWidth=Math.min(70,inside/2);
        if(gaps>1)flatWidth=Math.min(flatWidth,(inside/gaps-pt)/2);
        result.push(panel(role+':frame:left','Rodapé estrutural esquerdo',[frameLeft,f+2*pt,-h],[pt,railLength,uprightHeight],0,frame));
        result.push(panel(role+':frame:right','Rodapé estrutural direito',[frameRight-pt,f+2*pt,-h],[pt,railLength,uprightHeight],0,frame));
        result.push(panel(role+':flat:left','Travessa plana esquerda do rodapé',[frameLeft+pt,f+2*pt,-pt],[flatWidth,railLength,pt],2,frame));
        result.push(panel(role+':flat:right','Travessa plana direita do rodapé',[frameRight-pt-flatWidth,f+2*pt,-pt],[flatWidth,railLength,pt],2,frame));
        for(var i=1;i<gaps;i++){
          var x=frameLeft+pt+inside*i/gaps-pt/2;
          result.push(panel(role+':frame:cross:'+i,'Travessa do rodapé '+i,[x,f+2*pt,-h],[pt,railLength,uprightHeight],0,frame));
          result.push(panel(role+':flat:cross:'+i,'Travessa plana do rodapé '+i,[x+pt,f+2*pt,-pt],[flatWidth,railLength,pt],2,frame));
        }
        return result;
      }
      var origin=[0,t.setback,t.kind==='baseboard'?-t.height:p.height];
      result.push(panel(role,name,origin,[p.width,pt,t.height],1,t.material));
      if(t.kind==='crown'){
        var rearY=p.depth-t.setback_back-pt,startY=t.setback+pt,endY=t.crown_back?rearY:p.depth;
        if(t.crown_back)result.push(panel(role+':back','Rodateto traseiro',[0,rearY,p.height],[p.width,pt,t.height],1,t.material));
        if(t.crown_left)result.push(panel(role+':left','Rodateto esquerdo',[t.setback_left,startY,p.height],[pt,endY-startY,t.height],0,t.material));
        if(t.crown_right)result.push(panel(role+':right','Rodateto direito',[p.width-t.setback_right-pt,startY,p.height],[pt,endY-startY,t.height],0,t.material));
      }
      return result;
    },[]);
  }
  function normalize(raw,previous) {
    var p=Object.assign(clone(defaults),clone(raw));
    p.joint_banding=raw.joint_banding===undefined?(raw.claddings||[]).some(function(item){return item.mode==='thickened';}):raw.joint_banding;
    if(typeof p.joint_banding!=='boolean')throw new Error('Fitagem conjunta inválida.');
    var assemblyMode=raw&&Object.prototype.hasOwnProperty.call(raw,'assembly');
    p.module_family=raw&&Object.prototype.hasOwnProperty.call(raw,'module_family')?raw.module_family:(assemblyMode?'custom':'cabinet');
    if(['cabinet','custom','baseboard','functional','panel'].indexOf(p.module_family)<0||(p.module_family==='custom')!==assemblyMode)throw new Error('Família do módulo incompatível com sua receita.');
    var dimensionLimits=assemblyMode
      ? [['width','Largura do módulo de peças',1,10000],['height','Altura do módulo de peças',1,10000],['depth','Profundidade do módulo de peças',1,10000]]
      : [['width','Largura',100,4000],['height','Altura',p.module_family==='baseboard'?20:100,p.module_family==='baseboard'?1000:4000],['depth','Profundidade',80,1500]];
    if(p.module_family==='functional'){if(['door','drawer','cladding','crown','baseboard'].indexOf(p.component_kind)<0)throw new Error('Componente avulso inválido.');dimensionLimits=[['width','Largura',1,10000],['height','Altura',1,10000],['depth','Profundidade',1,10000]];}
    if(p.module_family==='panel')dimensionLimits=[['width','Largura do Painel',1,1e9],['height','Altura do Painel',1,1e9],['depth','Profundidade do Painel',1,10000]];
    dimensionLimits.concat([
      ['thickness','Espessura do MDF',6,40],['back_thickness','Espessura do fundo',3,25],
      ['back_setback','Recuo do fundo',0,300],['back_groove_depth','Profundidade do rasgo',.1,39],['rail_width','Largura das réguas',30,300],
      ['bottom_rail_width','Largura das réguas da base',30,300],['back_rail_width','Largura das réguas do fundo',30,300]
    ]).forEach(function(r){
      p[r[0]]=number(p[r[0]],r[1],r[2],r[3]);
      if(assemblyMode&&(r[0]==='width'||r[0]==='height'||r[0]==='depth'))p[r[0]]=cleanMm(p[r[0]]);
    });
    if(assemblyMode){
      if(!Array.isArray(p.assembly)||p.assembly.length>1024)throw new Error('Módulo de peças inválido.');
      p.assembly=p.assembly.map(function(entry){
        if(!entry||typeof entry!=='object'||!['origin','size'].every(function(key){return Array.isArray(entry[key])&&entry[key].length===3&&entry[key].every(function(v){return typeof v==='number'&&Number.isFinite(v)&&Math.abs(v)<=10000;});})||!entry.size.every(function(v){return v>0&&cleanMm(v)>0;}))throw new Error('As medidas das peças deste módulo são inválidas.');
        var value={name:String(entry.name||'').slice(0,60),origin:entry.origin.map(cleanMm),size:entry.size.map(cleanMm)};
        if(entry.reference){
          if(!Array.isArray(entry.reference)||entry.reference.length!==3||!entry.reference.every(function(v){return typeof v==='number'&&Number.isFinite(v)&&cleanMm(v)>0;}))throw new Error('Referência de medidas inválida.');
          value.reference=entry.reference.map(cleanMm);value.rule=normalizeRule(entry.rule||{});
        }
        return value;
      });
    }
    p.name=String(p.name==null?'':p.name).trim()||defaults.name;if(p.name.length>60)throw new Error('Use até 60 caracteres nos nomes.');
    ['material','back_material'].forEach(function(k){p[k]=materialName(p[k],defaults[k]);if(materialLength(p[k])>MATERIAL_NAME_LIMIT)throw new Error('Use até 128 caracteres no material.');});
    p.apparent_material=p.apparent_material?materialName(p.apparent_material,p.material):'';
    if(materialLength(p.apparent_material)>MATERIAL_NAME_LIMIT)throw new Error('Nome do material muito longo.');
    p.hidden_material=materialName(p.hidden_material,'Retalho');
    if(!p.reference_trims||typeof p.reference_trims!=='object'||Array.isArray(p.reference_trims))throw new Error('Referência de acabamentos inválida.');
    p.reference_trims=['baseboard','crown'].reduce(function(result,key){if(p.reference_trims[key]!==undefined)result[key]=number(p.reference_trims[key],'Cobertura de acabamento',0,10000);return result;},{});
    if(materialLength(p.hidden_material)>MATERIAL_NAME_LIMIT)throw new Error('Nome do material muito longo.');
    if (typeof p.back!=='boolean') throw new Error('Opção de fundo inválida.');
    [['base_type',['under','between']],['top_type',['full','rails']],['bottom_type',['full','rails']],['back_panel_type',['full','rails']],['top_join',['over','between']],['back_type',['applied','inset','groove']]].forEach(function(r){
      if (r[1].indexOf(p[r[0]])<0) throw new Error('Opção de construção inválida.');
    });
    if(!p.piece_settings||typeof p.piece_settings!=='object'||Array.isArray(p.piece_settings)||Object.keys(p.piece_settings).length>(p.module_family==='panel'?4096:1024))throw new Error('Fichas de peças inválidas.');
    Object.keys(p.piece_settings).forEach(function(role){if(!/^[a-zA-Z0-9_:\/-]{1,120}$/.test(role))throw new Error('Identificação de peça inválida.');p.piece_settings[role]=normalizePiece(p.piece_settings[role]);});
    if(p.module_family==='panel'){
      p.panel=PanelModel.normalize(p.panel||{},p,number);
      var channel=p.panel.fixation==='channel'&&PanelModel.grid(p).columns>1;
      p.depth=(channel?PanelModel.backDepth(p)+p.panel.wall_distance:PanelModel.backDepth(p))-PanelModel.frontDepth(p)+(p.panel.mirror!=='none'?p.panel.mirror_thickness:0);
      p.back=false;
    }
    if(!Array.isArray(p.excluded_pieces)||p.excluded_pieces.length>4096||p.excluded_pieces.some(function(role){return typeof role!=='string'||!/^[a-zA-Z0-9_:\/-]{1,120}$/.test(role);}))throw new Error('Lista de peças excluídas inválida.');
    p.excluded_pieces=p.excluded_pieces.filter(function(role,i,list){return list.indexOf(role)===i;});
    p.claddings=normalizeCladdings(p.claddings,p);
    if(!Array.isArray(p.trims)||p.trims.length>2)throw new Error('Lista de rodapés/rodatetos inválida.');
    p.trims=p.trims.map(function(t){return normalizeTrim(t,p);});
    if(p.module_family==='baseboard'){
      if(p.trims.length!==1||p.trims[0].kind!=='baseboard'||p.trims[0].structure_version!==1)throw new Error('Configure um único rodapé estrutural avulso.');
      p.back=false;
    }
    if(p.trims.some(function(t,i,a){return a.some(function(o,j){return j!==i&&o.kind===t.kind;});}))throw new Error('Já existe este acabamento no módulo.');
    if(p.cladding_overlap!==undefined){
      if(!p.cladding_overlap||typeof p.cladding_overlap!=='object'||Array.isArray(p.cladding_overlap)||!['top','bottom'].every(function(side){return ['horizontal','sides'].indexOf(p.cladding_overlap[side])>=0;}))throw new Error('Encontro dos tamponamentos inválido.');
      p.cladding_overlap={top:p.cladding_overlap.top,bottom:p.cladding_overlap.bottom};
    }
    if(!Array.isArray(p.accessories)||p.accessories.length>128)throw new Error('Lista de acessórios inválida.');
    p.accessories=p.accessories.map(normalizeAccessory);
    if(p.accessories.some(function(a,i,list){return list.some(function(o,j){return j!==i&&o.id===a.id;});}))throw new Error('Identificação de acessório repetida.');
    p.layout=normalizeNode(p.layout,'root',0);
    if(!Array.isArray(p.opening_layouts)||p.opening_layouts.length>128)throw new Error('Estrutura dos vãos livres inválida.');
    var spaceIds=[];
    p.opening_layouts=p.opening_layouts.map(function(v){
      if(!v||!/^space_[1-9]\d{0,15}$/.test(v.id)||Number(v.id.slice(6))>9007199254740990||!Array.isArray(v.nodes)||!v.nodes.length||v.nodes.length>128||!v.nodes.every(function(id){return typeof id==='string'&&/^(root|space_[1-9]\d{0,15})(\/[ab])*$/.test(id);}))throw new Error('Referência do vão livre inválida.');
      if(spaceIds.indexOf(v.id)>=0)throw new Error('Identificação de vão repetida.');spaceIds.push(v.id);
      return {id:v.id,nodes:Array.from(new Set(v.nodes)).sort(),layout:normalizeNode(v.layout,v.id,0)};
    });
    if(!Number.isSafeInteger(p.opening_sequence)||p.opening_sequence<0||p.opening_sequence>9007199254740990)throw new Error('Sequência de identidade dos vãos inválida.');
    p.opening_sequence=Math.max.apply(null,[p.opening_sequence].concat(p.opening_layouts.map(function(entry){return Number(entry.id.slice(6));})));
    if(p.module_family!=='cabinet'&&p.opening_layouts.length)throw new Error('Divisões de vãos pertencem somente à caixaria.');
    if (!Array.isArray(p.fronts)||p.fronts.length>64) throw new Error('Lista de frentes inválida.');
    p.fronts=p.fronts.map(function(f){return normalizeFront(f,p);});
    recalcDrawerDepthOnCabinetResize(p,previous);
    if(p.module_family==='baseboard'&&(p.fronts.length||p.layout.split||p.claddings.length))throw new Error('O rodapé avulso não recebe frentes, divisões ou tamponamentos de uma caixaria.');
    if(p.module_family==='panel'&&(p.fronts.length||p.layout.split||p.claddings.length||p.trims.length))throw new Error('Configure superfície, espelho e fixação na família Painel.');
    if(assemblyMode&&p.fronts.length)throw new Error('Um módulo de peças não pode conter uma receita de frentes sem validação de vãos.');
    if (p.fronts.some(function(f,i,a){return a.some(function(other,j){return j!==i&&other.id===f.id;});})) throw new Error('Identificação de frente repetida.');
    var active=layout(p,previous).panels.map(function(piece){return piece.role;}).concat(p.excluded_pieces);
    if(!assemblyMode)Object.keys(p.piece_settings).forEach(function(role){if(active.indexOf(role)<0)delete p.piece_settings[role];});
    p=D.canonical(p);p.dimension_precision=1;return p;
  }
  function normalizePiece(raw) {
    if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new Error('Ficha de peça inválida.');
    var d={};
    if(raw.texture_origin){if(!Array.isArray(raw.texture_origin)||raw.texture_origin.length!==2||!raw.texture_origin.every(function(n){return typeof n==='number'&&Number.isFinite(n)&&Math.abs(n)<=1e9;}))throw new Error('Origem lógica da textura inválida.');d.texture_origin=raw.texture_origin.slice();}
    if(raw.machining)d.machining=PanelModel.machining(raw.machining,number);
    if(raw.cut_orientation){if(['u_length','v_length'].indexOf(raw.cut_orientation)<0)throw new Error('Orientação de corte inválida.');d.cut_orientation=raw.cut_orientation;}
    if(raw.name!==undefined&&String(raw.name).trim()){d.name=String(raw.name).trim();if(d.name.length>60)throw new Error('Use até 60 caracteres no nome da peça.');}
    if(raw.adjustment)d.adjustment=clone(raw.adjustment);
    if(raw.thickness!==undefined&&raw.thickness!==null&&raw.thickness!=='')d.thickness=number(raw.thickness,'Espessura da peça',3,40);
    if(raw.material&&String(raw.material).trim()){d.material=materialName(raw.material,'Branco TX');if(materialLength(d.material)>MATERIAL_NAME_LIMIT)throw new Error('Use até 128 caracteres no material.');}
    d.construction_type=raw.construction_type||'mdf';
    if(['mdf','glass'].indexOf(d.construction_type)<0)throw new Error('Tipo construtivo da peça inválido.');
    if(d.construction_type==='mdf'&&d.material==='Retalho')d.material_policy='any_mdf';
    d.fixation=raw.fixation||'screw';
    if(['screw','dowel','connector','shelf_support','angle'].indexOf(d.fixation)<0)throw new Error('Fixação da peça inválida.');
    d.divider_mode=raw.divider_mode||'internal';if(['internal','batente'].indexOf(d.divider_mode)<0)throw new Error('Tipo de divisória inválido.');
    d.batente_depth=number(raw.batente_depth===undefined?70:raw.batente_depth,'Profundidade do batente',10,1500);
    d.front_recess=number(raw.front_recess===undefined?0:raw.front_recess,'Recuo frontal',0,1500);
    d.glass_color=raw.glass_color||'clear';
    if(['clear','smoke','bronze','green','mirror','white','black'].indexOf(d.glass_color)<0)throw new Error('Cor do vidro inválida.');
    d.led=raw.led===true;
    d.led_position=raw.led_position||'front';
    if(['front','center','rear'].indexOf(d.led_position)<0)throw new Error('Posição do LED inválida.');
    d.grain=raw.grain===undefined?'free':raw.grain;
    if(['free','u','v'].indexOf(d.grain)<0)throw new Error('Veio da peça inválido.');
    if(raw.grain_angle!==undefined)d.grain_angle=((number(raw.grain_angle,'Ângulo do veio',-36000,36000)%360)+360)%360;
    if(raw.edge_override!==undefined){if(typeof raw.edge_override!=='boolean')throw new Error('Substituição manual de fitas inválida.');d.edge_override=raw.edge_override;}
    var e=raw.edges===undefined?[]:raw.edges;
    if(!Array.isArray(e)||e.some(function(k){return ['u_min','u_max','v_min','v_max'].indexOf(k)<0;}))throw new Error('Bordas da peça inválidas.');
    d.edges=e.filter(function(k,i,a){return a.indexOf(k)===i;}).sort();
    if(raw.edge_materials){if(typeof raw.edge_materials!=='object'||Array.isArray(raw.edge_materials))throw new Error('Materiais de fita inválidos.');d.edge_materials={};Object.keys(raw.edge_materials).forEach(function(k){var n=raw.edge_materials[k];if(['u_min','u_max','v_min','v_max'].indexOf(k)<0||typeof n!=='string'||!n.trim()||materialLength(n)>MATERIAL_NAME_LIMIT)throw new Error('Material de fita inválido.');if(d.edges.indexOf(k)>=0)d.edge_materials[k]=materialName(n,'Branco TX');});}
    if(raw.face_materials){if(typeof raw.face_materials!=='object'||Array.isArray(raw.face_materials))throw new Error('Materiais de superfície inválidos.');d.face_materials={};Object.keys(raw.face_materials).forEach(function(k){var n=raw.face_materials[k];if(['face_min','face_max','u_min','u_max','v_min','v_max'].indexOf(k)<0||typeof n!=='string'||!n.trim()||materialLength(n)>MATERIAL_NAME_LIMIT)throw new Error('Material de superfície inválido.');d.face_materials[k]=materialName(n,'Branco TX');});}
    if(d.construction_type==='mdf'&&d.face_materials){
      Object.keys(d.face_materials).forEach(function(k){
        if(['u_min','u_max','v_min','v_max'].indexOf(k)<0)return;
        (d.edge_materials||(d.edge_materials={}))[k]=d.face_materials[k];delete d.face_materials[k];
        if(d.edges.indexOf(k)<0)d.edges.push(k);d.edge_override=true;
      });d.edges.sort();
    }
    d.tape_thickness=number(raw.tape_thickness===undefined?.4:raw.tape_thickness,'Espessura da fita',.1,5);
    d.edge_decrement=raw.edge_decrement===undefined?false:raw.edge_decrement;
    if(typeof d.edge_decrement!=='boolean')throw new Error('Desconto de fita inválido.');
    if(d.construction_type==='glass'){
      Object.assign(d,Glass.normalize(raw));d.material=Glass.label(d);
      d.edges=[];delete d.edge_materials;delete d.face_materials;d.grain='free';d.led=false;d.edge_decrement=false;
      delete d.grain_angle;
    }
    return D.canonical(d);
  }
  function thickness(p,role,fallback){var d=(p.piece_settings||{})[role]||{};return d.thickness===undefined?(fallback===undefined?p.thickness:fallback):d.thickness;}
  function splitDistance(node,free){return node.position_mode==='start'?node.distance:node.position_mode==='end'?free-node.distance:free*node.ratio;}
  // Existing auto-depth drawers follow a cabinet depth edit. Calculate from
  // the real closed opening, not just the external cabinet depth; manually
  // fixed depths are never replaced and validation reports when they no longer fit.
  function recalcDrawerDepthOnCabinetResize(p,previous){
    if(!previous||p.module_family!=='cabinet')return;
    var frontKeys=['nodes','side','fit','thickness','face_recess','recess','visibility','rear_clearance','runner','slide_clearance','hardware_layout_version','box_depth_auto'];
    var changedSpace=['depth','back','back_type','back_thickness','back_setback','back_groove_depth','back_panel_type','piece_settings','excluded_pieces','layout','opening_layouts'].some(function(key){return JSON.stringify(p[key])!==JSON.stringify(previous[key]);});
    var affected=p.fronts.filter(function(f){return f.kind==='drawers'&&f.box_depth_auto!==false;});
    if(!affected.length)return;
    var empty=clone(p);empty.fronts=[];
    var space=layout(empty),visible=space.panels.filter(function(piece){return p.excluded_pieces.indexOf(piece.role)<0;});
    affected.forEach(function(f){
      var old=(previous.fronts||[]).find(function(item){return item.id===f.id&&item.kind==='drawers';});
      if(!old)return;
      var changedFront=frontKeys.some(function(key){return JSON.stringify(f[key])!==JSON.stringify(old[key]);});
      if(!changedSpace&&!changedFront||Math.abs(f.box_depth-old.box_depth)>1e-7)return;
      if(f.nodes.length!==1||!space.nodes[f.nodes[0]])return;
      var region=space.nodes[f.nodes[0]],window=frontWindow(region,f.nodes,space.nodes,visible,space.nominal_panels);
      if(!window)throw new Error('A gaveta não possui um vão fechado para recalcular a profundidade.');
      var back=visible.find(function(piece){return piece.role==='back';});
      var end=back?Math.min(window.rear,back.origin[1]):window.rear;
      var start=drawerBoxStart(f,thickness(p,'front:'+f.id+':0:face',f.thickness));
      var room=end-window.front-start-f.rear_clearance;
      if(!changedFront){
        var oldEmpty=clone(previous);oldEmpty.fronts=[];var oldSpace=layout(oldEmpty),oldVisible=oldSpace.panels.filter(function(piece){return previous.excluded_pieces.indexOf(piece.role)<0;});
        var oldRegion=oldSpace.nodes[old.nodes[0]],oldWindow=oldRegion&&frontWindow(oldRegion,old.nodes,oldSpace.nodes,oldVisible,oldSpace.nominal_panels);
        if(oldWindow){var oldBack=oldVisible.find(function(piece){return piece.role==='back';}),oldLimit=oldBack?Math.min(oldWindow.rear,oldBack.origin[1]):oldWindow.rear;
          var oldStart=drawerBoxStart(old,thickness(previous,'front:'+old.id+':0:face',old.thickness));
          if(Math.abs(room-(oldLimit-oldWindow.front-oldStart-old.rear_clearance))<1e-7)return;
        }
      }
      if(room<100-1e-7)throw new Error('A profundidade útil do módulo não comporta a caixa da gaveta (mínimo de 100 mm).');
      if(f.runner==='telescopic'){var nominal=0;for(var length=150;length<=1000;length+=50)if(length<=room+1e-7)nominal=length;if(!nominal)throw new Error('Nenhum comprimento de corrediça cabe na profundidade disponível.');f.box_depth=nominal;}
      else f.box_depth=Math.min(1500,Math.floor((room+1e-7)*1000)/1000);
    });
  }
  function drawerBoxStart(front,faceThickness){
    if(front.visibility==='internal')return front.recess;
    var spacer=front.hardware_layout_version===1?0:2;
    return front.fit==='inset'?(front.face_recess||0)+(faceThickness===undefined?front.thickness:faceThickness)+spacer:spacer;
  }
  function panel(role,name,origin,size,axis,material) {
    return {role:role,name:name,origin:origin,size:size,thickness_axis:axis,material:material===undefined?null:material};
  }
  function overlaps(a,b) {
    return Math.min(a.x+a.width,b.x+b.width)-Math.max(a.x,b.x)>1e-7&&Math.min(a.z+a.height,b.z+b.height)-Math.max(a.z,b.z)>1e-7;
  }
  function frontRegion(f,nodes,openings,freeOpenings) {
    var selected=f.nodes.map(function(id){if(!nodes[id])throw new Error('Uma frente ficou sem seu vão. Remova essa frente antes de remover a divisão.');return nodes[id];});
    var x=Math.min.apply(null,selected.map(function(r){return r.x;})),z=Math.min.apply(null,selected.map(function(r){return r.z;}));
    var region={x:x,z:z,width:Math.max.apply(null,selected.map(function(r){return r.x+r.width;}))-x,height:Math.max.apply(null,selected.map(function(r){return r.z+r.height;}))-z};
    region.edges=[0,1,2,3].map(function(edge){return Math.min.apply(null,selected.filter(function(v){return Math.abs(edge===0?v.x-x:edge===1?v.x+v.width-x-region.width:edge===2?v.z-z:v.z+v.height-z-region.height)<1e-7;}).map(function(v){return v.edges[edge];}));});
    openings.forEach(function(o){
      if (overlaps(region,o)&&!f.nodes.some(function(id){return o.id===id||o.id.indexOf(id+'/')===0;})&&!(o.source_nodes&&o.source_nodes.every(function(source){return f.nodes.some(function(id){return source===id||source.indexOf(id+'/')===0;});}))) throw new Error('Escolha vãos vizinhos que formem um retângulo completo para a frente.');
    });
    var free=(freeOpenings||openings).some(function(o){return o.id.split('|').sort().join('|')===f.nodes.slice().sort().join('|');});
    if ((f.kind==='drawers'||f.fit==='inset')&&!free) throw new Error('Gavetas e frentes embutidas precisam de um único vão livre.');
    return region;
  }
  function addFront(p,f,r,depth,pieces) {
    if(advancedFront(p,f)){Array.prototype.push.apply(pieces,componentPanels(p,f,r,depth));return;}
    var t=p.thickness,g=f.gap,ft=f.thickness,x=r.x,z=r.z,rw=r.width,rh=r.height,x0,z0,x1,z1,y;
    var gl=f.gap_left,gr=f.gap_right,gb=f.gap_bottom,gt=f.gap_top;
    if (f.fit==='overlay') {
      x0=Math.abs(x-thickness(p,'left'))<1e-7?gl:x-r.edges[0]/2+gl/2;z0=Math.abs(z-thickness(p,p.bottom_type==='rails'?'bottom:front':'bottom'))<1e-7?gb:z-r.edges[2]/2+gb/2;
      x1=Math.abs(x+rw-(p.width-thickness(p,'right')))<1e-7?p.width-gr:x+rw+r.edges[1]/2-gr/2;
      z1=Math.abs(z+rh-(p.height-thickness(p,p.top_type==='full'?'top':'rail:front')))<1e-7?p.height-gt:z+rh+r.edges[3]/2-gt/2;y=-ft-2;
    } else {x0=x+gl;z0=z+gb;x1=x+rw-gr;z1=z+rh-gt;y=0;}
    var fw=x1-x0,fh=z1-z0,count=f.count,prefix='front:'+f.id,i;
    if (f.kind==='door') {
      if(f.door_type==='lift'){
        var leafH=(fh-(count-1)*g)/count;
        if(fw<50||leafH<50)throw new Error('A porta basculante ficou pequena demais.');
        for(i=0;i<count;i++){var lpt=thickness(p,prefix+':'+i,ft),lpy=f.fit==='overlay'?-lpt-2:0;
          if(f.fit==='inset'&&lpt>depth)throw new Error('A porta embutida é mais profunda que o vão.');
          pieces.push(panel(prefix+':'+i,count===1?'Porta basculante':'Porta basculante '+(i+1),[x0,lpy,z0+i*(leafH+g)],[fw,lpt,leafH],1,f.material));}
      }else{
        var leaf=(fw-(count-1)*g)/count;
        if(leaf<50||fh<50) throw new Error('A porta ficou pequena demais.');
        var doorLabel=f.door_type==='sliding'?'Porta de correr':'Porta de giro';
        for(i=0;i<count;i++){var pt=thickness(p,prefix+':'+i,ft),py=f.fit==='overlay'?-pt-2:0;
          if(f.fit==='inset'&&pt>depth)throw new Error('A porta embutida é mais profunda que o vão.');
          pieces.push(panel(prefix+':'+i,count===1?doorLabel:doorLabel+' '+(i+1),[x0+i*(leaf+g),py,z0],[leaf,pt,fh],1,f.material));}
      }
    } else {
      var frontH=(fh-(count-1)*g)/count,bw=rw-2*f.slide_clearance,bh=f.box_height,bd=f.box_depth,by=f.fit==='inset'?ft+2:2;
      var boxMaterial=f.box_material||p.material,boxBottomMaterial=f.box_material||p.back_material;
      if((f.hardware_layout_version===0&&!f.front_height_linked&&bh+10>rh/count)||frontH<50||fw<50)throw new Error('As folgas deixam as frentes pequenas demais para este vão.');
      var firstBottom=z+(f.hardware_layout_version===1&&f.runner==='telescopic'?f.runner_drop:f.base_clearance),overlayProjection=firstBottom-z0;
      var bottoms=[];
      for(i=0;i<count;i++){
        var proposedFaceBottom=z0+i*(frontH+g);
        bottoms.push(f.hardware_layout_version===1?
          (i===0?firstBottom:f.fit==='overlay'?proposedFaceBottom+overlayProjection:Math.max(z+i*rh/count+5,proposedFaceBottom+f.front_projection)):
          z+i*rh/count+5);
      }
      if(f.front_height_linked&&f.visibility!=='internal'){
        var available=Infinity;
        for(i=0;i<count;i++){
          var faceTop=z0+(i+1)*frontH+i*g,nextLimit=i+1===count?z+rh-10:bottoms[i+1]-2;
          available=Math.min(available,frontH,faceTop-bottoms[i],nextLimit-bottoms[i]);
        }
        bh=Math.min(bh,available);
        if(bh<40)throw new Error('As frentes não deixam altura suficiente para as caixas das gavetas.');
        f.box_height=bh;
      }
      for(i=0;i<count;i++){
        var faceBottom=z0+i*(frontH+g),dz=bottoms[i];
        var dx=x+f.slide_clearance,role=prefix+':'+i,n=i+1;
        if(f.hardware_layout_version===1||f.front_height_linked){
          var nextBottom=i+1===count?z+rh:bottoms[i+1];
          var clearance=i+1===count?10:2;
          if(dz+bh>nextBottom-clearance+0.001)throw new Error('Gaveta '+n+': reduza a altura da caixa para caber no vão.');
          if(f.hardware_layout_version===1&&i>0&&faceBottom-g>dz-f.runner_drop+0.001)throw new Error('Gaveta '+i+': a frente encosta na corrediça da gaveta acima. Aumente o desnível.');
        }
        var bt=thickness(p,role+':bottom',p.back_thickness),lt=thickness(p,role+':left'),rt=thickness(p,role+':right'),it=thickness(p,role+':inner'),et=thickness(p,role+':rear');
        var pt=thickness(p,role+':face',ft),attachedFace=f.hardware_layout_version===1&&f.visibility!=='internal';
        var faceRecess=f.fit==='inset'?f.face_recess:0;
        var py=f.fit==='overlay'?-pt-(attachedFace?0:2):faceRecess;
        var by=drawerBoxStart(f,pt);
        var innerHeight=bh-f.box_height_difference-bt;
        if(bw-lt-rt<50||bd-it-et<50||innerHeight<20)throw new Error('Gaveta '+n+': caixa incompatível com as espessuras ou dimensões úteis.');
        if(by+bd>depth-f.rear_clearance+1e-6)throw new Error('Gaveta '+n+': profundidade da caixa de '+bd+' mm excede os '+(depth-by-f.rear_clearance)+' mm disponíveis com esse recuo e folga traseira de '+f.rear_clearance+' mm.');
        if(f.visibility!=='internal')pieces.push(panel(role+':face','Frente da gaveta '+n,[x0,py,z0+i*(frontH+g)],[fw,pt,frontH],1,f.material));
        pieces.push(panel(role+':bottom','Fundo da gaveta '+n,[dx,by,dz],[bw,bd,bt],2,boxBottomMaterial));
        pieces.push(panel(role+':left','Lateral esquerda da gaveta '+n,[dx,by,dz+bt],[lt,bd,bh-bt],0,boxMaterial));
        pieces.push(panel(role+':right','Lateral direita da gaveta '+n,[dx+bw-rt,by,dz+bt],[rt,bd,bh-bt],0,boxMaterial));
        pieces.push(panel(role+':inner','Frente interna da gaveta '+n,[dx+lt,by,dz+bt],[bw-lt-rt,it,innerHeight],1,boxMaterial));
        pieces.push(panel(role+':rear','Traseira da gaveta '+n,[dx+lt,by+bd-et,dz+bt],[bw-lt-rt,et,innerHeight],1,boxMaterial));
      }
    }
  }
  function dividerChain(node){
    if(!node||['vertical','horizontal'].indexOf(node.split)<0)return [];
    var chain=[node],batch=node.insertion_batch,child;
    while(batch&&(child=chain[chain.length-1].second)&&child.split===node.split&&child.insertion_batch===batch)chain.push(child);
    return chain;
  }
  function proportionalDividers(p,node,span,reference){
    if(!reference||!node.keep_divider_proportions||reference.handled.indexOf(node.id)>=0)return;
    var chain=dividerChain(node),oldChain=dividerChain(find(reference.params,node.id));
    reference.handled=reference.handled.concat(chain.map(function(n){return n.id;}));
    if(JSON.stringify(chain.map(function(n){return n.id;}))!==JSON.stringify(oldChain.map(function(n){return n.id;}))||oldChain.some(function(n){return !n.keep_divider_proportions;}))return;
    if(chain.some(function(n){return p.excluded_pieces.indexOf('split:'+n.id)>=0;}))return;
    var region=reference.layout.nodes[node.id],parts=chain.map(function(n){return reference.layout.panels.find(function(b){return b.role==='split:'+n.id;});});
    if(!region||parts.some(function(b){return !b;}))return;
    var axis=node.split==='horizontal'?2:0,origin=axis===2?'z':'x',dimension=axis===2?'height':'width';
    var sizes=chain.map(function(n){return thickness(p,'split:'+n.id);});
    if(Math.abs(span-region[dimension])<1e-7&&sizes.every(function(t,i){return Math.abs(t-parts[i].size[axis])<1e-7;}))return;
    var cursor=region[origin],gaps=parts.map(function(b){var gap=b.origin[axis]-cursor;cursor=b.origin[axis]+b.size[axis];return gap;});
    gaps.push(region[origin]+region[dimension]-cursor);
    var free=span-sizes.reduce(function(a,b){return a+b;},0),total=gaps.reduce(function(a,b){return a+b;},0);
    if(total<-1e-7||free<0||gaps.some(function(g){return g<-1e-7;}))throw new Error('As peças ultrapassam o espaço disponível dos vãos.');
    chain.forEach(function(n,i){n.position_mode='start';n.distance=free*(total>1e-7?gaps[i]/total:1/gaps.length);var a=(p.piece_settings['split:'+n.id]||{}).adjustment;if(a)a.offset[axis]=0;});
  }
  function setDividerCount(raw,id,count){
    var p=normalize(raw),root=find(p,id),chain=dividerChain(root);
    if(!Number.isInteger(count)||count<1||count>8||!chain.length)throw new Error('Quantidade de divisórias inválida.');
    if(count===chain.length)return p;
    var axis=root.split,physicalAxis=axis==='horizontal'?2:0;
    var region=layout(p).nodes[id],uses=function(key){return key===id||key.indexOf(id+'/')===0;};
    if(p.fronts.some(function(f){return f.nodes.some(uses);})||p.opening_layouts.some(function(e){return e.nodes.some(uses);})||chain.some(function(n){return n.first.split||p.excluded_pieces.indexOf('split:'+n.id)>=0;})||chain[chain.length-1].second.split)throw new Error('Para alterar a quantidade, remova antes as outras inserções deste conjunto de vãos.');
    var template=clone(p.piece_settings['split:'+id]||{}),settings=chain.map(function(n){return p.piece_settings['split:'+n.id]||template;}),batch=root.insertion_batch||'div_'+id.replace(/\//g,'_'),keep=!!root.keep_divider_proportions;
    chain.forEach(function(n){delete p.piece_settings['split:'+n.id];});
    var node=root,nodes=[];
    for(var i=0;i<count;i++){
      var key=i===0?id:nodes[nodes.length-1].id+'/b';Object.keys(node).forEach(function(k){delete node[k];});
      Object.assign(node,{id:key,split:axis,ratio:.5,position_mode:'start',distance:50,insertion_batch:batch,keep_divider_proportions:keep,first:{id:key+'/a'},second:{id:key+'/b'}});
      nodes.push(node);var data=clone(settings[i]||template);if(data.adjustment)data.adjustment.offset[physicalAxis]=0;p.piece_settings['split:'+key]=data;node=node.second;
    }
    var gap=(region[axis==='horizontal'?'height':'width']-nodes.reduce(function(sum,n){return sum+thickness(p,'split:'+n.id);},0))/(count+1);
    if(gap<-1e-7)throw new Error('As divisórias ultrapassam o espaço disponível dos vãos.');
    nodes.forEach(function(n){n.distance=gap;});return normalize(p);
  }
  function layout(p,previous) {return D.layout(layoutExact(p,previous));}
  function layoutExact(p,previous) {
    function enabled(n){return n&&n.split&&(n.keep_divider_proportions||enabled(n.first)||enabled(n.second));}
    var active=enabled(p.layout)||(p.opening_layouts||[]).some(function(e){return enabled(e.layout);});
    var reference=active&&previous&&(previous.module_family||'cabinet')==='cabinet'&&!previous.assembly?{params:previous,layout:layout(clone(previous)),handled:[]}:null;
    if(p.module_family==='panel')return PanelModel.layout(p,{panel:panel,finish:finishPanel,normalizePiece:normalizePiece});
    if(p.module_family==='functional'){
      var region={id:'root',x:0,z:0,width:p.width,height:p.height,edges:[0,0,0,0],front:0,rear:p.depth,depth:p.depth};
      var functional=p.component_kind==='cladding'?claddingPanels(p):['baseboard','crown'].indexOf(p.component_kind)>=0?trimPanels(p):[];
      if(['door','drawer'].indexOf(p.component_kind)>=0)p.fronts.forEach(function(f){addFront(p,f,region,p.depth,functional);});
      if(p.component_kind==='crown'&&!p.volume_bound)functional.forEach(function(piece){piece.origin[2]-=p.height;});
      functional.forEach(function(piece){finishPanel(p,piece);});
      if(p.component_kind==='cladding')finishExposedCladdingEdges(p,functional);
      functional=functional.filter(function(piece){return (p.excluded_pieces||[]).indexOf(piece.role)<0;});
      return {panels:functional,openings:['door','drawer'].indexOf(p.component_kind)>=0?[region]:[],nodes:{root:region},boards:functional.map(function(b){return {role:b.role,x:b.origin[0],z:b.origin[2],w:b.size[0],h:b.size[2]};})};
    }
    if(p.module_family==='baseboard'){
      var baseboard=trimPanels(p);baseboard.forEach(function(piece){piece.origin[2]+=p.height;finishPanel(p,piece);});
      baseboard=baseboard.filter(function(piece){return (p.excluded_pieces||[]).indexOf(piece.role)<0;});
      return {panels:baseboard,openings:[],nodes:{},boards:baseboard.map(function(b){return {role:b.role,x:b.origin[0],z:b.origin[2],w:b.size[0],h:b.size[2]};})};
    }
    if(p.assembly)return {panels:[],openings:[],nodes:{},boards:p.assembly.map(function(b,i){
      var size=b.size.slice(),origin=b.origin.slice();
      if(b.reference&&b.rule)['width','depth','height'].forEach(function(key,axis){var r=b.rule[key],delta=p[key]-b.reference[axis],growth=r.follow?delta:0;size[axis]+=growth;origin[axis]+=({start:0,center:.5,end:1}[r.anchor])*(delta-growth);});
      if(size.some(function(v){return !Number.isFinite(v)||v<=0;}))throw new Error('Uma peça ficaria sem medida. Revise as dimensões ou o comportamento.');
      return {role:'assembly:'+i,x:origin[0],z:origin[2],w:size[0],h:size[2]};})};
    var w=p.width,h=p.height,d=p.depth,lt=thickness(p,'left'),rt=thickness(p,'right'),bt=thickness(p,p.bottom_type==='rails'?'bottom:front':'bottom');
    if(p.bottom_type==='rails'&&thickness(p,'bottom:back')!==bt)throw new Error('As duas réguas da base precisam ter a mesma espessura para apoiar as laterais.');
    var tt=thickness(p,p.top_type==='full'?'top':'rail:front');
    if(p.top_type==='rails'&&thickness(p,'rail:back')!==tt)throw new Error('As duas réguas superiores precisam ter a mesma espessura para apoiar as laterais.');
    var backRails=p.back&&p.back_panel_type==='rails',b=p.back?(backRails?Math.max(thickness(p,'back:top'),thickness(p,'back:bottom')):thickness(p,'back',p.back_thickness)):0,applied=p.back&&!backRails&&p.back_type==='applied';
    var grooved=p.back&&!backRails&&p.back_type==='groove',groove=grooved?p.back_groove_depth:0;
    if(grooved&&groove>=Math.min(lt,rt,bt,tt))throw new Error('A profundidade do rasgo precisa ser menor que a espessura das peças da caixaria.');
    var body=applied?d-b:d,inner=p.back?d-b-(applied||backRails?0:p.back_setback):d,under=p.base_type==='under',over=p.top_join==='over';
    if(inner<0)throw new Error('A profundidade livre do vão não pode ser negativa.');
    var sideH=h-(under?bt:0)-(over?tt:0),tx=over?0:lt,tw=over?w:w-lt-rt;
    var pieces=[panel('left','Lateral esquerda',[0,0,under?bt:0],[lt,body,sideH],0),
      panel('right','Lateral direita',[w-rt,0,under?bt:0],[rt,body,sideH],0)];
    var bx=under?0:lt,bw=under?w:w-lt-rt;
    if(p.bottom_type==='full')pieces.push(panel('bottom','Base',[bx,0,0],[bw,body,bt],2));
    else {
      if(2*p.bottom_rail_width>body)throw new Error('As duas réguas da base não cabem na profundidade da caixaria.');
      pieces.push(panel('bottom:front','Régua inferior frontal',[bx,0,0],[bw,p.bottom_rail_width,bt],2));
      pieces.push(panel('bottom:back','Régua inferior traseira',[bx,body-p.bottom_rail_width,0],[bw,p.bottom_rail_width,bt],2));
    }
    if(p.top_type==='full')pieces.push(panel('top','Tampo',[tx,0,h-tt],[tw,body,tt],2));
    else {
      if(2*p.rail_width>body)throw new Error('As duas réguas não cabem na profundidade da caixaria.');
      pieces.push(panel('rail:front','Régua superior frontal',[tx,0,h-tt],[tw,p.rail_width,tt],2));
      pieces.push(panel('rail:back','Régua superior traseira',[tx,body-p.rail_width,h-tt],[tw,p.rail_width,tt],2));
    }
    var openings=[],nodes={};
    function walk(node,x,z,rw,rh,edges) {
      if(rw<-1e-7||rh<-1e-7)throw new Error('A medida livre do vão não pode ser negativa.');
      var region={id:node.id,x:x,z:z,width:rw,height:rh,edges:edges};nodes[node.id]=region;
      if(!node.split){openings.push(region);return;}
      var t=thickness(p,'split:'+node.id);proportionalDividers(p,node,node.split==='horizontal'?rh:rw,reference);
      var first=splitDistance(node,(node.split==='horizontal'?rh:rw)-t);
      if(node.split==='horizontal'){
        pieces.push(panel('split:'+node.id,'Prateleira',[x,0,z+first],[rw,inner,t],2));
        walk(node.first,x,z,rw,first,[edges[0],edges[1],edges[2],t]);walk(node.second,x,z+first+t,rw,rh-first-t,[edges[0],edges[1],t,edges[3]]);
      } else {
        var dividerData=p.piece_settings['split:'+node.id]||{},batente=dividerData.divider_mode==='batente',partDepth=batente?(dividerData.batente_depth||70)+(dividerData.front_recess||0):inner;
      if(partDepth>inner+1e-6)throw new Error('O batente é mais profundo que o vão.');
      var divider=panel('split:'+node.id,batente?'Batente frontal':'Divisória',[x+first,0,z],[t,partDepth,rh],0);if(batente)divider.opening_depth=inner-(dividerData.front_recess||0);pieces.push(divider);
        walk(node.first,x,z,first,rh,[edges[0],t,edges[2],edges[3]]);walk(node.second,x+first+t,z,rw-first-t,rh,[t,edges[1],edges[2],edges[3]]);
      }
    }
    walk(p.layout,lt,bt,w-lt-rt,h-bt-tt,[lt,rt,bt,tt]);
    if(p.back){
      if(backRails){
        if(2*p.back_rail_width>h-bt-tt)throw new Error('As duas réguas do fundo não cabem na altura interna da caixaria.');
        pieces.push(panel('back:bottom','Régua do fundo inferior',[lt,d-thickness(p,'back:bottom'),bt],[w-lt-rt,thickness(p,'back:bottom'),p.back_rail_width],1));
        pieces.push(panel('back:top','Régua do fundo superior',[lt,d-thickness(p,'back:top'),h-tt-p.back_rail_width],[w-lt-rt,thickness(p,'back:top'),p.back_rail_width],1));
      }else pieces.push(applied?panel('back','Fundo sobreposto',[0,body,0],[w,b,h],1):panel('back',grooved?'Fundo embutido em rasgo':'Fundo interno',[lt-groove,inner,bt-groove],[w-lt-rt+2*groove,b,h-bt-tt+2*groove],1));
    }
    if(grooved){
      var grooveRoles=['left','right',p.bottom_type==='full'?'bottom':'bottom:back',p.top_type==='full'?'top':'rail:back'];
      pieces.filter(function(piece){return grooveRoles.indexOf(piece.role)>=0&&p.excluded_pieces.indexOf(piece.role)<0;}).forEach(function(piece){
        var offset=inner-piece.origin[1];
        if(offset < -1e-6||offset+b>piece.size[1]+1e-6)throw new Error('O recuo do fundo coloca o rasgo fora da base ou da parte superior. Ajuste o recuo ou a largura das réguas.');
        piece.grooves=[{direction:piece.thickness_axis===0?'vertical':'horizontal',offset:Math.max(offset,0),width:b,depth:groove,logical_index:0,face_axis:piece.thickness_axis,face_sign:['left','bottom','bottom:back'].indexOf(piece.role)>=0?1:-1}];
      });
    }
    p.opening_layouts.forEach(function(entry){
      var selected=entry.nodes.map(function(id){if(!nodes[id])throw new Error('Uma divisão ficou sem seu vão de referência.');return nodes[id];});
      var x=Math.min.apply(null,selected.map(function(r){return r.x;})),z=Math.min.apply(null,selected.map(function(r){return r.z;}));
      var region={x:x,z:z,width:Math.max.apply(null,selected.map(function(r){return r.x+r.width;}))-x,height:Math.max.apply(null,selected.map(function(r){return r.z+r.height;}))-z};
      region.edges=[0,1,2,3].map(function(edge){return Math.min.apply(null,selected.filter(function(r){return Math.abs([r.x-x,r.x+r.width-x-region.width,r.z-z,r.z+r.height-z-region.height][edge])<.001;}).map(function(r){return r.edges[edge];}));});
      var remaining=pieces.filter(function(piece){return p.excluded_pieces.indexOf(piece.role)<0;}),physical=clone(remaining);
      physical.forEach(function(piece){piece.material=piece.material||(piece.role==='back'?p.back_material:p.material);finishPanel(p,piece);});
      var window=windowBounds(region,physical,remaining)||Object.assign({front:0,rear:inner,depth:inner},region);
      if(physical.some(function(piece){return [0,2].indexOf(piece.thickness_axis)>=0&&overlaps(window,{x:piece.origin[0],z:piece.origin[2],width:piece.size[0],height:piece.size[2]});}))throw new Error('Uma divisão atravessa uma peça existente.');
      var sources=Array.from(new Set(selected.reduce(function(all,r){return all.concat(r.source_nodes||[r.id]);},[]))),start=pieces.length,previousDepth=inner;
      openings=openings.filter(function(r){return !overlaps(region,r);});inner=window.depth;
      walk(entry.layout,window.x,window.z,window.width,window.height,region.edges);inner=previousDepth;
      pieces.slice(start).forEach(function(piece){piece.origin[1]+=window.front;});
      Object.keys(nodes).forEach(function(id){if(id===entry.id||id.indexOf(entry.id+'/')===0)nodes[id].source_nodes=sources;});
    });
    pieces.forEach(function(piece){piece.material=piece.role==='back'?p.back_material:p.material;});
    var nominal=clone(pieces);
    pieces.forEach(function(piece){finishPanel(p,piece);});
    pieces.forEach(function(piece){
      if(piece.role.indexOf('split:')!==0||piece.thickness_axis!==2||p.excluded_pieces.indexOf(piece.role)>=0)return;
      var region=nodes[piece.role.slice(6)];if(!region)return;
      var visible=pieces.filter(function(board){return p.excluded_pieces.indexOf(board.role)<0;}),
          visibleNominal=nominal.filter(function(board){return p.excluded_pieces.indexOf(board.role)<0;}),
          window=windowBounds(region,visible,visibleNominal);
      if(!window)return;
      var base=nominal.find(function(board){return board.role===piece.role;});
      piece.origin[1]+=window.front-base.origin[1];piece.size[1]+=window.depth-base.size[1];
      if(piece.size[1]<=0)throw new Error('A prateleira ficou sem profundidade útil neste vão.');
      base.origin[1]=window.front;base.size[1]=window.depth;
    });
    var freeOpenings=mergedOpenings(openings,pieces,nominal,p.excluded_pieces);
    p.fronts.forEach(function(f){
      var r=frontRegion(f,nodes,openings,freeOpenings);
      var visible=pieces.filter(function(piece){return p.excluded_pieces.indexOf(piece.role)<0;});
      var window=frontWindow(r,f.nodes,nodes,visible,nominal);
      if(!window)throw new Error('As peças deste vão não têm fechamento e profundidade comuns.');
      if(f.side==='rear'&&p.back)throw new Error('Remova o fundo para inserir por trás da caixaria.');
      var generated=[];
      addFront(p,f,Object.assign({},r,window),(backRails?window.rear:Math.min(window.rear,inner))-window.front,generated);
      generated.forEach(function(piece){piece.origin[1]=f.side==='rear'?window.rear-piece.origin[1]-piece.size[1]:window.front+piece.origin[1];finishPanel(p,piece);
        if(pieces.some(function(other){return other.role.indexOf('front:')===0&&[0,1,2].every(function(a){return Math.min(piece.origin[a]+piece.size[a],other.origin[a]+other.size[a])-Math.max(piece.origin[a],other.origin[a])>1e-5;});}))throw new Error('Os elementos inseridos se cruzam. Revise o recuo e a profundidade.');
      });
      pieces=pieces.concat(generated);
    });
    trimPanels(p).forEach(function(piece){finishPanel(p,piece);pieces.push(piece);});
    claddingPanels(p).forEach(function(piece){finishPanel(p,piece);pieces.push(piece);});
    finishExposedCladdingEdges(p,pieces);
    pieces=pieces.filter(function(piece){return (p.excluded_pieces||[]).indexOf(piece.role)<0;});
    var boards=pieces.filter(function(b){return b.role!=='back'&&b.role.indexOf('back:')!==0&&b.role.indexOf('front:')!==0;}).map(function(b){return{role:b.role,x:b.origin[0],z:b.origin[2],w:b.size[0],h:b.size[2]};});
    return {openings:freeOpenings,nodes:nodes,panels:pieces,boards:boards,nominal_panels:nominal};
  }

  var FRONT_EDGES=['u_min','u_max','v_min','v_max'],NON_FRONT_SUFFIXES=['bottom','left','right','inner','rear'];
  function frontPanelRole(role){var value=String(role||''),parts=value.split(':');return value.indexOf('front:')===0&&NON_FRONT_SUFFIXES.indexOf(parts[parts.length-1])<0;}
  function carcassFrontEdge(piece){
    if(piece.role==='left'||piece.role==='right')return 'u_min';
    if(['bottom','top','rail:front','rail:back','bottom:front','bottom:back'].indexOf(piece.role)>=0)return 'v_min';
    if(piece.role.indexOf('split:')===0)return piece.thickness_axis===0?'u_min':'v_min';
    return null;
  }
  function finishExposedCladdingEdges(p,pieces){
    var claddings=pieces.filter(function(piece){return piece.role.indexOf('cladding:')===0;});
    claddings.forEach(function(piece){
      var data=piece.settings;if(data.edge_override||data.construction_type==='glass')return;
      var axis=piece.thickness_axis,otherAxis=axis===0?2:0,edges=[];
      if(axis===0){
        if(piece.role.indexOf(':rear:')<0)edges.push('u_min');
        if(piece.role.indexOf(':front:')<0)edges.push('u_max');
        data.edges=edges;data.edge_materials={};edges.forEach(function(edge){data.edge_materials[edge]=piece.material;});
        p.piece_settings[piece.role]=data;return;
      }
      if(piece.role.indexOf(':rear:')<0)edges.push('v_min');
      ['min','max'].forEach(function(end){
        var boundary=piece.origin[otherAxis]+(end==='max'?piece.size[otherAxis]:0);
        var covered=claddings.some(function(other){
          if(other===piece)return false;
          var adjoining=end==='max'?other.origin[otherAxis]:other.origin[otherAxis]+other.size[otherAxis];
          if(Math.abs(adjoining-boundary)>=.001)return false;
          return [0,1,2].filter(function(i){return i!==otherAxis;}).every(function(i){
            return other.origin[i]<=piece.origin[i]+.001&&other.origin[i]+other.size[i]>=piece.origin[i]+piece.size[i]-.001;
          });
        });
        if(!covered)edges.push((axis===0?'v':'u')+'_'+end);
      });
      data.edges=edges;data.edge_materials={};edges.forEach(function(edge){data.edge_materials[edge]=piece.material;});
      p.piece_settings[piece.role]=data;
    });
  }
  function finishPanel(p,piece){
    var inherited=piece.default_construction_type?{construction_type:piece.default_construction_type}:{};if(piece.default_glass_model)inherited.glass_model=piece.default_glass_model;var data=normalizePiece(Object.assign(inherited,(p.piece_settings||{})[piece.role]||{}));if(frontPanelRole(piece.role)&&!data.edge_override&&data.construction_type!=='glass')data.edges=FRONT_EDGES.slice();if(data.name)piece.name=data.name;piece.material=data.material||piece.material;piece.settings=data;
    if(data.machining&&data.machining.grooves.some(function(g){return g.face_axis===0||g.face_axis===2;}))delete data.machining;
    if(piece.grooves)data.machining={kind:'grooves',grooves:piece.grooves};
    if(['trim:baseboard','trim:baseboard:back'].indexOf(piece.role)>=0&&!data.edge_override&&data.construction_type!=='glass'){
      var trim=(p.trims||[]).find(function(item){return item.kind==='baseboard'&&item.structure_version===1;});
      if(trim){
        // U is physical X on these boards; front/back cover the side rail ends.
        data.edges=['left','right'].map(function(side,i){return trim['finish_'+side]&&(p.excluded_pieces||[]).indexOf('trim:baseboard:'+side)<0?'u_'+(i===0?'min':'max'):null;}).filter(Boolean);
        var colors=data.edge_materials||{};data.edge_materials={};data.edges.forEach(function(edge){data.edge_materials[edge]=colors[edge]||piece.material;});
        if(!data.edges.length)delete data.edge_materials;
      }
    }
    var carcassEdge=carcassFrontEdge(piece);
    if(carcassEdge&&!data.edge_override&&data.construction_type!=='glass'){data.edges=[carcassEdge];data.edge_materials={};data.edge_materials[carcassEdge]=['rail:back','bottom:back'].indexOf(piece.role)>=0?p.material:piece.material;}
    if(/^front:[^:]+:\d+:(left|right|inner|rear)$/.test(piece.role)&&!data.edge_override&&data.construction_type!=='glass'){
      data.edges=['v_max'];data.edge_materials={v_max:piece.material};
    }
    if(piece.default_edges&&!data.edge_override&&data.construction_type==='mdf'){data.edges=piece.default_edges.slice();data.edge_materials={};data.edges.forEach(function(edge){data.edge_materials[edge]=piece.material;});}
    if(data.front_recess){
      piece.origin[1]+=data.front_recess;piece.size[1]-=data.front_recess;
    }
    if(data.adjustment){piece.size=piece.size.map(function(v,i){return i===piece.thickness_axis?v:v+data.adjustment.size[i];});piece.origin=piece.origin.map(function(v,i){return v+data.adjustment.offset[i];});}
    if(!piece.size.every(function(v){return v>0;}))throw new Error(piece.name+': medidas insuficientes para esta montagem.');
    var uv=[0,1,2].filter(function(i){return i!==piece.thickness_axis;});
    // Compatibility initialization only; fitting is decided by the Ruby backend.
    if(!data.cut_orientation)data.cut_orientation=piece.size[uv[0]]>=piece.size[uv[1]]?'u_length':'v_length';
    p.piece_settings[piece.role]=data;
    return piece;
  }
  function normalizeCladdings(raw,p){
    if(!Array.isArray(raw)||raw.length>4)throw new Error('Tamponamentos inválidos.');
    var sides=[];
    return raw.map(function(v){
      if(!v||['left','right','top','bottom'].indexOf(v.side)<0||sides.indexOf(v.side)>=0)throw new Error('Posição do tamponamento inválida ou repetida.');
      sides.push(v.side);var material=materialName(v.material,p.material);
      if(materialLength(material)>MATERIAL_NAME_LIMIT)throw new Error('Nome do material inválido.');
      var item={side:v.side,material:material,thickness:number(v.thickness===undefined?p.thickness:v.thickness,'Espessura do tamponamento',6,40),front:number(v.front||0,'Avanço frontal',0,300),rear:number(v.rear||0,'Avanço traseiro',0,300)};
      ['extend_top','extend_bottom'].forEach(function(key){item[key]=number(v[key]===undefined?0:v[key],'Ajuste das laterais '+(key==='extend_top'?'no topo':'na base'),-4000,4000);});
      if(v.side==='left'||v.side==='right'){
        ['cover_baseboard','cover_crown'].forEach(function(key){
          if(v[key]!==undefined&&typeof v[key]!=='boolean')throw new Error('Cobertura do rodapé/rodateto inválida.');
          if(v[key]!==undefined)item[key]=v[key];
        });
      }
      if(v.mode!==undefined){
        if(['panel','rail','thickened'].indexOf(v.mode)<0)throw new Error('Montagem do tamponamento inválida.');
        item.mode=v.mode;
        if(v.mode!=='panel')item.rail_depth=number(v.rail_depth===undefined?50:v.rail_depth,'Profundidade da régua',10,1500);
        if(v.mode==='thickened'){
          item.layers=number(v.layers===undefined?1:v.layers,'Camadas de engrosso',1,6);
          if(item.layers!==Math.floor(item.layers))throw new Error('Camadas de engrosso devem ser inteiras.');
        }
      }
      return item;
    });
  }
  function claddingPanels(p){
    var values=p.claddings||[],widths={},names={left:'esquerdo',right:'direito',top:'superior',bottom:'inferior'};
    if(p.cladding_overlap||values.some(function(v){return Number(v.extend_top||0)!==0||Number(v.extend_bottom||0)!==0;}))return configuredCladdingPanels(p,values,names);
    if(values.every(function(v){return v.mode===undefined;})){
      values.forEach(function(v){widths[v.side]=thickness(p,'cladding:'+v.side,v.thickness);});
      return values.map(function(v){
        var side=v.side,t=widths[side],d=p.depth+v.front+v.rear,origin,size,axis;
        if(side==='left'||side==='right'){origin=[side==='left'?-t:p.width,-v.front,0];size=[t,d,p.height];axis=0;}
        else{origin=[-(widths.left||0),-v.front,side==='bottom'?-t:p.height];size=[p.width+(widths.left||0)+(widths.right||0),d,t];axis=2;}
        return panel('cladding:'+side,'Tamponamento '+names[side],origin,size,axis,v.material);
      });
    }
    var bounds={left:0,right:p.width,bottom:0,top:p.height},pieces=[];
    values.forEach(function(v){
      var side=v.side,mode=v.mode||'panel',base='cladding:'+side;
      var primary=mode==='rail'?base+':front:1':base,t=thickness(p,primary,v.thickness);
      var depth=p.depth+v.front+v.rear,frontY=-v.front,rearY=p.depth+v.rear,railDepth=v.rail_depth||50;
      var layers=mode==='thickened'?v.layers:0;
      if(mode!=='panel'&&(railDepth>depth||(mode==='thickened'&&2*railDepth>depth)))throw new Error('Profundidade das réguas maior que o espaço disponível.');
      function add(role,name,offset,y,partDepth,material){
        var origin,size,axis;
        if(side==='left'){origin=[bounds.left-(offset+1)*t,y,bounds.bottom];size=[t,partDepth,bounds.top-bounds.bottom];axis=0;}
        else if(side==='right'){origin=[bounds.right+offset*t,y,bounds.bottom];size=[t,partDepth,bounds.top-bounds.bottom];axis=0;}
        else if(side==='top'){origin=[bounds.left,y,bounds.top+offset*t];size=[bounds.right-bounds.left,partDepth,t];axis=2;}
        else{origin=[bounds.left,y,bounds.bottom-(offset+1)*t];size=[bounds.right-bounds.left,partDepth,t];axis=2;}
        pieces.push(panel(role,name,origin,size,axis,material===undefined?v.material:material));
      }
      if(mode==='rail')add(base+':front:1','Régua frontal do tamponamento '+names[side],0,frontY,railDepth);
      if(mode==='thickened')for(var i=0;i<layers;i++){
        add(base+':front:'+(i+1),'Régua frontal '+(i+1)+' do tamponamento '+names[side],i,frontY,railDepth);
        add(base+':rear:'+(i+1),'Régua traseira '+(i+1)+' do tamponamento '+names[side],i,rearY-railDepth,railDepth,p.hidden_material);
      }
      if(mode!=='rail')add(base,'Tamponamento '+names[side],layers,frontY,depth);
      var total=(layers+1)*t;
      if(side==='left')bounds.left-=total;
      else if(side==='right')bounds.right+=total;
      else if(side==='top')bounds.top+=total;
      else bounds.bottom-=total;
    });
    return pieces;
  }
  function configuredCladdingPanels(p,values,names){
    var overlap=p.cladding_overlap||{top:'horizontal',bottom:'horizontal'};
    var bySide={},widths={},trims={},pieces=[];
    values.forEach(function(v){
      bySide[v.side]=v;
      var role='cladding:'+v.side+(v.mode==='rail'?':front:1':'');
      widths[v.side]=(v.mode==='thickened'?v.layers+1:1)*thickness(p,role,v.thickness);
    });
    var trimItems={};
    (p.trims||[]).forEach(function(t){trims[t.kind]=t.kind==='baseboard'&&t.structure_version===1?t.height-t.foot_height:t.height;trimItems[t.kind]=t;});
    Object.keys(p.reference_trims||{}).forEach(function(key){trims[key]=Math.max(trims[key]||0,p.reference_trims[key]);});
    function covers(side,kind){
      var trim=trimItems[kind],legacy=kind==='baseboard'?'cover_baseboard':'cover_crown';
      return trim&&trim.cover_cladding!==undefined?trim.cover_cladding:bySide[side][legacy]!==false;
    }
    var topCover=['left','right'].some(function(side){return bySide[side]&&covers(side,'crown');});
    var bottomCover=['left','right'].some(function(side){return bySide[side]&&covers(side,'baseboard');});
    var topStart=p.height+(topCover?(trims.crown||0):0);
    var bottomStart=bottomCover?-(trims.baseboard||0):0;
    var topSpec=bySide.top,topLayers=topSpec&&topSpec.mode==='thickened'?topSpec.layers:0;
    var topRailThickness=topSpec?thickness(p,'cladding:top:front:1',topSpec.thickness):0;
    var topPanelStart=topStart+topLayers*topRailThickness;
    var sidePanelThickness={};['left','right'].forEach(function(position){var spec=bySide[position];
      sidePanelThickness[position]=spec&&spec.mode!=='rail'?thickness(p,'cladding:'+position,spec.thickness):0;});
    values.forEach(function(v){
      var side=v.side,mode=v.mode||'panel',base='cladding:'+side;
      var t=thickness(p,mode==='rail'?base+':front:1':base,v.thickness);
      var depth=p.depth+v.front+v.rear,railDepth=v.rail_depth||50,layers=mode==='thickened'?v.layers:0;
      if(mode!=='panel'&&(railDepth>depth||(mode==='thickened'&&2*railDepth>depth)))throw new Error('Profundidade das réguas maior que o espaço disponível.');
      var lower,upper;
      if(side==='left'||side==='right'){
        var coverBaseboard=covers(side,'baseboard'),coverCrown=covers(side,'crown');
        lower=(coverBaseboard?bottomStart:0)-(overlap.bottom==='sides'?(widths.bottom||0):0);
        upper=(coverCrown?topStart:p.height)+(overlap.top==='sides'?(widths.top||0):0);
        if(coverBaseboard&&trims.baseboard)lower=Math.min(lower,-trims.baseboard);
        if(coverCrown&&trims.crown)upper=Math.max(upper,p.height+trims.crown);
        lower-=v.extend_bottom||0;upper+=v.extend_top||0;
      }
      function add(role,name,offset,y,partDepth,material){
        var origin,size,axis,x,w;
        if(side==='left'){var leftTop=role===base&&topSpec&&overlap.top==='horizontal'?topPanelStart+(v.extend_top||0):upper;
          origin=[-(offset+1)*t,y,lower];size=[t,partDepth,leftTop-lower];axis=0;}
        else if(side==='right'){var rightTop=role===base&&topSpec&&overlap.top==='horizontal'?topPanelStart+(v.extend_top||0):upper;
          origin=[p.width+offset*t,y,lower];size=[t,partDepth,rightTop-lower];axis=0;}
        else if(side==='top'){
          x=overlap.top==='horizontal'?-(widths.left||0):0;
          w=p.width+(overlap.top==='horizontal'?(widths.left||0)+(widths.right||0):0);
          if(role!==base&&overlap.top==='horizontal'){
            x+=sidePanelThickness.left;w-=sidePanelThickness.left+sidePanelThickness.right;
          }
          origin=[x,y,topStart+offset*t];size=[w,partDepth,t];axis=2;
        }else{
          x=overlap.bottom==='horizontal'?-(widths.left||0):0;
          w=p.width+(overlap.bottom==='horizontal'?(widths.left||0)+(widths.right||0):0);
          origin=[x,y,bottomStart-(offset+1)*t];size=[w,partDepth,t];axis=2;
        }
        if(size.some(function(n){return n<=0;}))throw new Error('Ajuste das laterais '+((v.extend_bottom||0)<0?'na base':'no topo')+': a combinação deixa a peça sem medida física suficiente.');
        pieces.push(panel(role,name,origin,size,axis,material===undefined?v.material:material));
      }
      if(mode==='rail')add(base+':front:1','Régua frontal do tamponamento '+names[side],0,-v.front,railDepth);
      if(mode==='thickened')for(var i=0;i<layers;i++){
        add(base+':front:'+(i+1),'Régua frontal '+(i+1)+' do tamponamento '+names[side],i,-v.front,railDepth);
        add(base+':rear:'+(i+1),'Régua traseira '+(i+1)+' do tamponamento '+names[side],i,p.depth+v.rear-railDepth,railDepth,p.hidden_material);
      }
      if(mode!=='rail')add(base,'Tamponamento '+names[side],layers,-v.front,depth);
    });
    return pieces;
  }
  function windowBounds(region,pieces,nominal){
    nominal=nominal||pieces;var x=region.x,z=region.z,w=region.width,h=region.height;
    var groups=[0,1,2,3].map(function(edge){return nominal.filter(function(b){
      if(b.role==='back'||b.role.indexOf('back:')===0||b.role.indexOf('front:')===0||b.role.indexOf('cladding:')===0)return false;
      var o=b.origin,s=b.size,vertical=edge<2,axis=vertical?0:2,target=[x,x+w,z,z+h][edge],inner=o[axis]+(edge===0||edge===2?s[axis]:0);
      var span=vertical?[o[2],o[2]+s[2],z,z+h]:[o[0],o[0]+s[0],x,x+w];
      return b.thickness_axis===axis&&Math.abs(inner-target)<.01&&span[0]<=span[2]+.01&&span[1]>=span[3]-.01;
    }).map(function(b){return pieces.find(function(v){return v.role===b.role;});}).filter(Boolean);});
    if(groups.some(function(g){return !g.length;}))return null;
    var limits=groups.map(function(g,e){var axis=e<2?0:2,v=g.map(function(b){return b.origin[axis]+(e===0||e===2?b.size[axis]:0);});return (e===0||e===2?Math.max:Math.min).apply(null,v);});
    groups=groups.map(function(g,e){var axis=e<2?2:0,lo=e<2?limits[2]:limits[0],hi=e<2?limits[3]:limits[1];return g.filter(function(b){return b.origin[axis]<=lo+.01&&b.origin[axis]+b.size[axis]>=hi-.01;});});
    if(groups.some(function(g){return !g.length;}))return null;
    var front=Math.max.apply(null,groups.slice(0,2).map(function(g){return Math.min.apply(null,g.map(function(b){return b.origin[1];}));}));
    var rear=Math.min.apply(null,groups.slice(0,2).map(function(g){return Math.max.apply(null,g.map(function(b){return b.origin[1]+(b.opening_depth===undefined?b.size[1]:b.opening_depth);}));}));
    pieces.forEach(function(piece){if((piece.role==='back'||piece.role.indexOf('back:')===0)&&overlaps(region,{x:piece.origin[0],z:piece.origin[2],width:piece.size[0],height:piece.size[2]}))rear=Math.min(rear,piece.origin[1]);});
    if(limits[1]<=limits[0]||limits[3]<=limits[2]||rear<=front)return null;
    return {x:limits[0],z:limits[2],width:limits[1]-limits[0],height:limits[3]-limits[2],front:front,rear:rear,depth:rear-front};
  }
  // Combine separately closed bays; never substitute missing walls or depth.
  function frontWindow(region,ids,nodes,pieces,nominal){
    var single=windowBounds(region,pieces,nominal);
    if(single||ids.length<2)return single;
    var windows=ids.map(function(id){return nodes[id]&&windowBounds(nodes[id],pieces,nominal);});
    if(windows.some(function(window){return !window;}))return null;
    var boundaries=[0,1,2,3].map(function(edge){
      var axis=edge<2?'x':'z',span=edge<2?'width':'height',far=edge===1||edge===3,target=region[axis]+(far?region[span]:0);
      var values=windows.filter(function(window,i){var node=nodes[ids[i]];return Math.abs(node[axis]+(far?node[span]:0)-target)<.01;})
        .map(function(window){return window[axis]+(far?window[span]:0);});
      return values.length?(far?Math.min.apply(null,values):Math.max.apply(null,values)):null;
    });
    var front=Math.max.apply(null,windows.map(function(window){return window.front;})),rear=Math.min.apply(null,windows.map(function(window){return window.rear;}));
    if(boundaries.some(function(value){return value===null;})||boundaries[1]<=boundaries[0]||boundaries[3]<=boundaries[2]||rear<=front)return null;
    return {x:boundaries[0],z:boundaries[2],width:boundaries[1]-boundaries[0],height:boundaries[3]-boundaries[2],front:front,rear:rear,depth:rear-front};
  }
  // Keep historical construction IDs; discover rectangular free space using
  // the enclosing boards that remain after deletion, including the freed slab.
  function mergedOpenings(openings,pieces,nominal,excluded){
    if(!excluded.some(function(role){return role.indexOf('split:')===0;}))return openings;
    var remaining=pieces.filter(function(b){return excluded.indexOf(b.role)<0;}),base=nominal.filter(function(b){return excluded.indexOf(b.role)<0;});
    var removed=nominal.filter(function(b){return b.role.indexOf('split:')===0&&excluded.indexOf(b.role)>=0;}),result=clone(openings),joined;
    do{
      joined=false;
      for(var i=0;i<result.length&&!joined;i++)for(var j=i+1;j<result.length;j++){
        var a=result[i],b=result[j],axis=Math.abs(a.z-b.z)<.01&&Math.abs(a.height-b.height)<.01?0:Math.abs(a.x-b.x)<.01&&Math.abs(a.width-b.width)<.01?2:null;
        if(axis===null)continue;
        var key=axis===0?'x':'z',size=axis===0?'width':'height',first=a[key]<b[key]?a:b,second=first===a?b:a,start=first[key]+first[size],end=second[key];
        if(!removed.some(function(p){var cross=axis===0?2:0,crossKey=axis===0?'z':'x',crossSize=axis===0?'height':'width';return p.thickness_axis===axis&&Math.abs(p.origin[axis]-start)<.01&&Math.abs(p.origin[axis]+p.size[axis]-end)<.01&&p.origin[cross]<=first[crossKey]+.01&&p.origin[cross]+p.size[cross]>=first[crossKey]+first[crossSize]-.01;}))continue;
        var region=clone(first);region[size]=second[key]+second[size]-first[key];
        var window=windowBounds(region,remaining,base);
        if(remaining.some(function(p){return (p.thickness_axis===0||p.thickness_axis===2)&&p.role.indexOf('front:')!==0&&p.role.indexOf('cladding:')!==0&&overlaps(window||region,{x:p.origin[0],z:p.origin[2],width:p.size[0],height:p.size[2]});}))continue;
        region.id=a.id.split('|').concat(b.id.split('|')).sort().join('|');region.edges[axis===0?1:3]=second.edges[axis===0?1:3];
        result[i]=region;result.splice(j,1);joined=true;break;
      }
    }while(joined);
    return result;
  }
  function windows(raw){
    var p=normalize(raw);if(p.assembly||p.module_family!=='cabinet')return [];
    p.fronts=[];p.claddings=[];p.trims=[];var actual=layout(p);
    return actual.openings.map(function(r){var v=windowBounds(r,actual.panels,actual.nominal_panels);return v?Object.assign({id:r.id},v):null;}).filter(Boolean);
  }
  function find(node,id){if(node.layout)return find(node.layout,id)||(node.opening_layouts||[]).map(function(v){return find(v.layout,id);}).find(Boolean)||null;if(node.id===id)return node;return node.split?find(node.first,id)||find(node.second,id):null;}
  // Explicit write preparation only. Reads keep their original identities.
  function compactOpenings(raw,protect){
    var p=normalize(raw);if(p.module_family!=='cabinet'||p.assembly)return p;
    var before=layout(p),excluded=p.excluded_pieces;
    function belongs(id,root){return id===root||id.indexOf(root+'/')===0;}
    function dead(node){return !node.split||(excluded.indexOf('split:'+node.id)>=0&&dead(node.first)&&dead(node.second));}
    function covers(node,ids){return ids.indexOf(node.id)>=0||(node.split&&covers(node.first,ids)&&covers(node.second,ids));}
    var fixed=p.fronts.reduce(function(all,f){return all.concat(f.nodes);},[]).concat((protect||[]).reduce(function(all,id){return all.concat(id.split('|'));},[]));
    p.opening_layouts.slice().reverse().forEach(function(entry){
      if(!dead(entry.layout)||fixed.some(function(id){return belongs(id,entry.id);}))return;
      var consumers=p.opening_layouts.filter(function(other){return other!==entry&&other.nodes.some(function(id){return belongs(id,entry.id);});});
      if(!consumers.every(function(other){return covers(entry.layout,other.nodes);}))return;
      consumers.forEach(function(other){other.nodes=Array.from(new Set(other.nodes.reduce(function(all,id){return all.concat(belongs(id,entry.id)?entry.nodes:[id]);},[]))).sort();});
      p.opening_layouts=p.opening_layouts.filter(function(other){return other!==entry;});
    });
    var references=fixed.concat(p.opening_layouts.reduce(function(all,entry){return all.concat(entry.nodes);},[]));
    function prune(node){
      if(!node.split)return;
      if(dead(node)&&!references.some(function(id){return id.indexOf(node.id+'/')===0;})){
        Object.keys(node).forEach(function(key){if(key!=='id')delete node[key];});
      }else{prune(node.first);prune(node.second);}
    }
    prune(p.layout);p.opening_layouts.forEach(function(entry){prune(entry.layout);});
    function obsolete(role){var node=role.indexOf('split:')===0&&find(p,role.slice(6));return role.indexOf('split:')===0&&(!node||!node.split);}
    p.excluded_pieces=excluded.filter(function(role){return !obsolete(role);});
    Object.keys(p.piece_settings).forEach(function(role){if(obsolete(role))delete p.piece_settings[role];});
    var result=normalize(p),after=layout(result);
    function equal(a,b){if(a===b)return true;if(!a||!b||typeof a!=='object'||typeof b!=='object')return false;var keys=Object.keys(a);return keys.length===Object.keys(b).length&&keys.every(function(k){return Object.prototype.hasOwnProperty.call(b,k)&&equal(a[k],b[k]);});}
    if(!equal(before.panels,after.panels)||!fixed.every(function(id){var a=before.nodes[id],b=after.nodes[id];return a&&b&&['id','x','z','width','height','edges'].every(function(k){return equal(a[k],b[k]);});}))throw new Error('A compactação alteraria uma peça ou referência válida.');
    return result;
  }
  function divisionId(p,id){return find(p,id)?id:p.opening_layouts.slice().reverse().find(function(entry){return entry.nodes.join('|')===id;}).id;}
  function split(raw,id,axis){
    var p=normalize(raw),available=windows(p);if(!available.some(function(w){return w.id===id;}))throw new Error('Selecione um vão livre.');
    // Preserve every selectable destination while a multi-opening recipe is built.
    p=compactOpenings(p,available.map(function(w){return w.id;}));var node=find(p,id);
    if(!node){var next=++p.opening_sequence;var entry={id:'space_'+next,nodes:id.split('|').sort(),layout:{}};p.opening_layouts.push(entry);node=entry.layout;}
    if(node.split)throw new Error('Selecione um vão livre.');
    node.split=axis;node.ratio=.5;node.first={};node.second={};node.keep_divider_proportions=true;return normalize(p);
  }
  function remove(raw,id){
    if(id==='root'||id.lastIndexOf('/')<0)throw new Error('Este vão ainda não tem uma divisão.');
    return removeDivision(raw,id.substring(0,id.lastIndexOf('/')));
  }
  function removalImpact(raw,id){
    var p=normalize(raw),node=find(p,id);
    if(!node||!node.split)throw new Error('Selecione a prateleira ou divisória que deseja remover.');
    return {roles:layout(p).panels.filter(function(b){return b.role==='split:'+id||b.role.indexOf('split:'+id+'/')===0;}).map(function(b){return b.role;}),
      fronts:p.fronts.filter(function(f){return f.nodes.some(function(n){return n.indexOf(id+'/')===0;});}).map(function(f){return f.id;})};
  }
  function removeDivision(raw,id){
    var impact=removalImpact(raw,id),p=clone(raw),node=find(p,id);
    // Preserve all historical references, including newer regional partitions.
    p.excluded_pieces=Array.from(new Set(p.excluded_pieces.concat(impact.roles)));
    p.fronts=p.fronts.filter(function(f){return impact.fronts.indexOf(f.id)<0;});
    Object.keys(p.piece_settings).forEach(function(role){if(impact.roles.indexOf(role)>=0||impact.fronts.some(function(f){return role.indexOf('front:'+f+':')===0;}))delete p.piece_settings[role];});
    return normalize(p);
  }
  var api={compactOpenings:compactOpenings,divisionId:divisionId,removalImpact:removalImpact,removeDivision:removeDivision,windows:windows,defaults:defaults,clone:clone,normalizePiece:normalizePiece,frontPanelRole:frontPanelRole,thickness:thickness,splitDistance:splitDistance,number:number,normalize:normalize,layout:layout,find:find,split:split,remove:remove};
  api.dividerChain=dividerChain;api.setDividerCount=setDividerCount;
  api.calculate=calculate;api.cleanMm=cleanMm;
  api.drawerBoxStart=drawerBoxStart;
  api.hasSideCladdings=hasSideCladdings;api.baseboardSideSetbacks=baseboardSideSetbacks;
  api.MATERIAL_NAME_LIMIT=MATERIAL_NAME_LIMIT;
  if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.MyDinaModel=api;
})(this);
