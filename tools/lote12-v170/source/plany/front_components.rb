# encoding: UTF-8
module RQMyDina
  # Parametric components share the existing recipe/panel and DC authorities.
  module FrontComponents
    RUNNER_LENGTHS = (150..1000).step(50).to_a.freeze
    def self.number(raw, key, default, label, min, max)
      Parameters.number(raw.fetch(key, default), label, min, max)
    end
    def self.normalize(f, raw, p, saved)
      if f['kind']=='drawers'
        if raw['drawer_type']=='spice'
          f['drawer_type']='spice'
          f['spice_levels']=number(raw,'spice_levels',2,'Níveis do tempereiro',1,2)
          raise ArgumentError,'Quantidade de níveis inválida.' unless f['spice_levels']==f['spice_levels'].to_i
          f['spice_levels']=f['spice_levels'].to_i
          f['spice_thickness']=number(raw,'spice_thickness',15,'Espessura do tempereiro',6,40)
          f['spice_front_height']=number(raw,'spice_front_height',0,'Altura da contrafrente',0,4000)
          f['spice_front_top']=number(raw,'spice_front_top',20,'Recuo superior da contrafrente',0,1000)
          f['spice_second_height']=number(raw,'spice_second_height',0,'Altura do segundo nível',0,4000)
          f['spice_runners']=raw.fetch('spice_runners','per_level')
          raise ArgumentError,'Configuração das corrediças do tempereiro inválida.' unless %w[per_level diagonal left right].include?(f['spice_runners'])
          raise ArgumentError,'A disposição escolhida precisa dos dois níveis do tempereiro.' if f['spice_levels']==1 && f['spice_runners']!='per_level'
          raise ArgumentError,'O tempereiro usa apenas corrediças telescópicas.' unless f['runner']=='telescopic'
          f['count']=1
          f['front_height_linked']=false
          f['hardware_layout_version']=1
        end
        if p['module_family']=='functional' && p['component_kind']=='drawer'
          %w[include_front include_runners].each do |key|
            f[key]=raw.fetch(key,true)
            raise ArgumentError,'Opção da gaveta avulsa inválida.' unless [true,false].include?(f[key])
          end
          %w[left right top bottom].each { |side| f['advance_'+side]=number(raw,'advance_'+side,0,'Avanço da frente',-1000,4000) }
          f['loose_drawer']=true
          f['count']=1;f['box_depth']=p['depth'];f['box_height']=p['height'];f['box_depth_auto']=false
          f['hardware_layout_version']=1;f['front_height_linked']=false
        end
      elsif f['door_type']=='sliding' && (!saved || raw['sliding_version']==1)
        f['sliding_version']=1
        f['track_count']=number(raw,'track_count',f['count']==1 ? 1 : 2,'Quantidade de vias',1,8)
        raise ArgumentError,'A quantidade de vias deve ser inteira.' unless f['track_count']==f['track_count'].to_i
        f['track_count']=f['track_count'].to_i
        f['overlap']=number(raw,'overlap',30,'Transpasse',0,1000)
        f['track_height']=number(raw,'track_height',15,'Altura do trilho',2,100)
        f['sliding_limit_left']=number(raw,'sliding_limit_left',0,'Limite esquerdo',-10_000,10_000)
        f['sliding_limit_right']=raw['sliding_limit_right'].nil? || raw['sliding_limit_right'].to_s.empty? ? nil : number(raw,'sliding_limit_right',p['width'],'Limite direito',-10_000,20_000)
        leaves=raw.fetch('sliding_leaves',[])
        raise ArgumentError,'Configuração das folhas inválida.' unless leaves.is_a?(Array) && leaves.length<=4
        f['sliding_leaves']=f['count'].times.map do |i|
          leaf=leaves[i] || {};raise ArgumentError,'Folha inválida.' unless leaf.is_a?(Hash)
          type=leaf.fetch('type','mdf');raise ArgumentError,'Material da folha inválido.' unless %w[mdf profile_mdf profile_glass profile_mirror].include?(type)
          track=number(leaf,'track',i%f['track_count'],'Via da folha',0,f['track_count']-1)
          raise ArgumentError,'A via deve ser inteira.' unless track==track.to_i
          data={'type'=>type,'track'=>track.to_i,'material'=>Parameters.material_name(leaf.fetch('material',f['material'])),
            'width'=>number(leaf,'width',0,'Largura manual da folha',0,10_000),
            'weight'=>number(leaf,'weight',1,'Proporção da folha',0.001,10_000),
            'thickness'=>number(leaf,'thickness',type=='profile_glass' ? 6 : type=='profile_mirror' ? 4 : f['thickness'],'Espessura da folha',3,40),
            'profile_width'=>number(leaf,'profile_width',20,'Largura do perfil',5,100),
            'profile_depth'=>number(leaf,'profile_depth',25,'Profundidade do perfil',5,100),
            'profile_wall'=>number(leaf,'profile_wall',1.5,'Espessura do perfil',0.5,10),
            'engagement'=>number(leaf,'engagement',6,'Encaixe do perfil',0,50),
            'finish'=>Parameters.material_name(leaf.fetch('finish','Alumínio natural'))}
          if type!='mdf' && (data['engagement']>=data['profile_width'] || data['profile_depth']<data['thickness']+2*data['profile_wall'])
            raise ArgumentError,'O perfil não comporta a espessura ou o encaixe da folha.'
          end
          data
        end
      end
      f
    end
    def self.advanced?(p,f)
      f['drawer_type']=='spice' || p['module_family']=='functional' && p['component_kind']=='drawer' || f['sliding_version']==1
    end
    def self.front_bounds(p,f,r)
      if f['fit']=='overlay'
        return [f['gap_left'],f['gap_bottom'],p['width']-f['gap_right'],p['height']-f['gap_top']] unless p['module_family']=='cabinet'
        x,z,w,h=r.values_at('x','z','width','height');le,re,be,te=r['edges']
        [(x-Parameters.thickness(p,'left')).abs<1e-7 ? f['gap_left'] : x-le/2+f['gap_left']/2,
          (z-Parameters.thickness(p,p['bottom_type']=='rails' ? 'bottom:front' : 'bottom')).abs<1e-7 ? f['gap_bottom'] : z-be/2+f['gap_bottom']/2,
          (x+w-(p['width']-Parameters.thickness(p,'right'))).abs<1e-7 ? p['width']-f['gap_right'] : x+w+re/2-f['gap_right']/2,
          (z+h-(p['height']-Parameters.thickness(p,p['top_type']=='full' ? 'top' : 'rail:front'))).abs<1e-7 ? p['height']-f['gap_top'] : z+h+te/2-f['gap_top']/2]
      else
        [r['x']+f['gap_left'],r['z']+f['gap_bottom'],r['x']+r['width']-f['gap_right'],r['z']+r['height']-f['gap_top']]
      end
    end
    def self.panels(p,f,r,depth)
      return loose_drawer(p,f) if p['module_family']=='functional' && p['component_kind']=='drawer'
      return spice(p,f,r,depth) if f['drawer_type']=='spice'
      sliding(p,f,r,depth)
    end
    def self.board(role,name,origin,size,axis,material,edges=nil)
      part=Parameters.panel(role,name,origin,size,axis,material)
      part['default_edges']=edges if edges
      part
    end
    def self.loose_drawer(p,f)
      w,d,h=p.values_at('width','depth','height');t=p['thickness'];bt=p['back_thickness'];prefix="front:#{f['id']}:0"
      raise ArgumentError,'A caixa da gaveta avulsa ficou pequena para as espessuras.' if w-2*t<50 || d-2*t<50 || h-bt<20
      material=f['box_material'].to_s.empty? ? p['material'] : f['box_material']
      bottom_material=f['box_material'].to_s.empty? ? p['back_material'] : material
      pieces=[board(prefix+':bottom','Fundo da gaveta',[0,0,0],[w,d,bt],2,bottom_material),
        board(prefix+':left','Lateral esquerda da gaveta',[0,0,bt],[t,d,h-bt],0,material),
        board(prefix+':right','Lateral direita da gaveta',[w-t,0,bt],[t,d,h-bt],0,material),
        board(prefix+':inner','Contrafrente da gaveta',[t,0,bt],[w-2*t,t,h-bt],1,material),
        board(prefix+':rear','Traseira da gaveta',[t,d-t,bt],[w-2*t,t,h-bt],1,material)]
      if f['include_front']
        left,right,top,bottom=%w[left right top bottom].map { |side| f['advance_'+side] }
        raise ArgumentError,'Os avanços deixam a frente sem dimensões úteis.' if w+left+right<50 || h+top+bottom<50
        pieces << board(prefix+':face','Frente da gaveta',[-left,-f['thickness'],-bottom],[w+left+right,f['thickness'],h+top+bottom],1,f['material'])
      end
      pieces
    end
    def self.spice(p,f,r,depth)
      t=f['spice_thickness'];w=r['width']-2*f['slide_clearance'];d=f['box_depth']
      x=r['x']+f['slide_clearance'];y=Parameters.drawer_box_start(f);z=r['z']+10
      front_top=f['spice_front_height']>0 ? z+f['spice_front_height'] : r['z']+r['height']-f['spice_front_top'];levels=f['spice_levels']
      raise ArgumentError,'O tempereiro não cabe na largura ou profundidade disponível.' if w-2*t<25 || d-2*t<50 || y+d>depth-f['rear_clearance']+1e-6
      bottoms=[z]
      if levels==2
        upper=f['spice_second_height']>0 ? r['z']+f['spice_second_height'] : [z+(front_top-z)/2,front_top-(t+20+60+10)].min
        raise ArgumentError,'Os dois níveis do tempereiro não cabem sem sobrepor as laterais.' if upper<z+t+20+60+10-1e-6
        bottoms << upper
      end
      rear_top=bottoms.last+t+20+60+5
      raise ArgumentError,'A contrafrente precisa ultrapassar a contraposterior e caber no vão.' if rear_top>=front_top || front_top>r['z']+r['height']
      prefix="front:#{f['id']}:0";material=f['box_material'].to_s.empty? ? p['material'] : f['box_material']
      pieces=[board(prefix+':inner','Contrafrente contínua do tempereiro',[x,y,z],[w,t,front_top-z],1,material),
        board(prefix+':rear','Contraposterior contínua do tempereiro',[x,y+d-t,z],[w,t,rear_top-z],1,material)]
      bottoms.each_with_index do |bottom,i|
        key=i.zero? ? prefix : prefix+":level#{i+1}"
        pieces << board(key+':bottom',"Fundo do tempereiro #{i+1}",[x,y+t,bottom],[w,d-2*t,t],2,material,%w[u_min u_max])
        pieces << board(key+':left',"Lateral esquerda do tempereiro #{i+1}",[x,y+t,bottom+t+20],[t,d-2*t,60],0,material,%w[v_min v_max])
        pieces << board(key+':right',"Lateral direita do tempereiro #{i+1}",[x+w-t,y+t,bottom+t+20],[t,d-2*t,60],0,material,%w[v_min v_max])
      end
      x0,z0,x1,z1=front_bounds(p,f,r)
      py=f['fit']=='overlay' ? -f['thickness'] : f['face_recess']
      pieces << board(prefix+':face','Frente do tempereiro',[x0,py,z0],[x1-x0,f['thickness'],z1-z0],1,f['material'])
      pieces
    end
    def self.sliding(p,f,r,depth)
      x0,z0,x1,z1=front_bounds(p,f,r);span=x1-x0;leaves=f['sliding_leaves'];overlap=f['overlap'];rail=f['track_height']
      total=span+overlap*(f['count']-1);fixed=leaves.select { |leaf| leaf['width']>0 };automatic=leaves-fixed
      remainder=total-fixed.sum { |leaf| leaf['width'] };weights=automatic.sum { |leaf| leaf['weight'] }
      raise ArgumentError,'As larguras manuais não atendem ao transpasse e ao espaço disponível.' if automatic.empty? && remainder.abs>0.05 || !automatic.empty? && remainder<50*automatic.length
      widths=leaves.map { |leaf| leaf['width']>0 ? leaf['width'] : remainder*leaf['weight']/weights }
      raise ArgumentError,'O transpasse ou as folgas deixam as folhas pequenas demais.' if widths.any? { |width| width<50 || width<=overlap } || z1-z0-2*rail<50
      pitch=leaves.map { |leaf| leaf['type']=='mdf' ? leaf['thickness'] : leaf['profile_depth'] }.max+6
      limit_left=x0+f['sliding_limit_left'];limit_right=f['sliding_limit_right'] ? x0+f['sliding_limit_right'] : x1
      raise ArgumentError,'Os limites não comportam as folhas de correr.' if limit_right-limit_left<widths.max
      pieces=[];x=x0
      leaves.each_with_index do |leaf,i|
        width=widths[i];outer_depth=leaf['type']=='mdf' ? leaf['thickness'] : leaf['profile_depth']
        y=f['fit']=='overlay' ? -f['track_count']*pitch-2+leaf['track']*pitch : leaf['track']*pitch
        raise ArgumentError,'As vias da porta embutida ultrapassam a profundidade do vão.' if f['fit']=='inset' && y+outer_depth>depth
        raise ArgumentError,'A folha fechada ultrapassa os limites configurados.' if x<limit_left-1e-5 || x+width>limit_right+1e-5
        framed=leaf['type']!='mdf';border=framed ? leaf['profile_width']-leaf['engagement'] : 0
        material=leaf['type']=='profile_mirror' ? 'Espelho' : leaf['type']=='profile_glass' ? leaf['material'].start_with?('Vidro') ? leaf['material'] : 'Vidro Incolor' : leaf['material']
        piece=board("front:#{f['id']}:#{i}","Porta de correr #{i+1}",[x+border,y+(outer_depth-leaf['thickness'])/2,z0+rail+border],
          [width-2*border,leaf['thickness'],z1-z0-2*rail-2*border],1,material)
        raise ArgumentError,'O perfil deixa a folha sem preenchimento útil.' if piece['size'].values_at(0,2).any? { |size| size<10 } || framed && [width,z1-z0-2*rail].any? { |size| size<=2*leaf['profile_width'] }
        piece['default_construction_type']='glass' if %w[profile_glass profile_mirror].include?(leaf['type'])
        piece['default_glass_model']='espelho' if leaf['type']=='profile_mirror'
        piece['sliding']={'index'=>i,'track'=>leaf['track'],'x'=>x,'y'=>y,'z'=>z0+rail,'width'=>width,'height'=>z1-z0-2*rail,'depth'=>outer_depth,
          'limit_left'=>limit_left,'limit_right'=>limit_right,'pitch'=>pitch,'rail_height'=>rail,'rail_z'=>z0,'leaf'=>leaf}
        pieces << piece;x+=width-overlap
      end
      # Leaves on one track must have a physical gap in the closed position.
      pieces.combination(2).each do |a,b|
        sa,sb=a['sliding'],b['sliding'];next unless sa['track']==sb['track']
        raise ArgumentError,'As folhas se sobrepõem na mesma via. Escolha outra distribuição.' if [sa['x']+sa['width'],sb['x']+sb['width']].min>[sa['x'],sb['x']].max+1e-5
      end
      pieces
    end
  end
end
