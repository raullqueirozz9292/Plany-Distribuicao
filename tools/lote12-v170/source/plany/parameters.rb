# encoding: UTF-8
components_path = File.join(__dir__, 'front_components.rb')
is_a?(Module) ? module_eval(File.read(components_path, encoding: 'UTF-8'), components_path, 1) : load(components_path)
dimensions_path = File.join(__dir__, 'dimensions.rb')
is_a?(Module) ? module_eval(File.read(dimensions_path, encoding: 'UTF-8'), dimensions_path, 1) : load(dimensions_path)
glass_path = File.join(__dir__, 'glass.rb')
is_a?(Module) ? module_eval(File.read(glass_path, encoding: 'UTF-8'), glass_path, 1) : load(glass_path)
orientation_path = File.join(__dir__, 'piece_orientation.rb')
is_a?(Module) ? module_eval(File.read(orientation_path, encoding: 'UTF-8'), orientation_path, 1) : load(orientation_path)
panel_path = File.join(__dir__, 'panel.rb')
is_a?(Module) ? module_eval(File.read(panel_path, encoding: 'UTF-8'), panel_path, 1) : load(panel_path)
joint_path = File.join(__dir__, 'joint_banding.rb')
is_a?(Module) ? module_eval(File.read(joint_path, encoding: 'UTF-8'), joint_path, 1) : load(joint_path)
module RQMyDina
  # Normalize the legacy label at data boundaries; cutting uses an explicit policy.
  module MaterialPolicy
    NAME = 'Retalho'.freeze
    ANY_MDF = 'any_mdf'.freeze
    def self.retalho?(value)
      %w[Retalho SOBRA].include?(value.to_s.strip)
    end
    def self.normalize_name(value)
      retalho?(value) ? NAME : value
    end
    def self.flexible?(row)
      row.fetch('construction_type', 'mdf') == 'mdf' && row['material_policy'] == ANY_MDF
    end
    def self.normalize_row(row)
      result = row.dup
      result['material'] = normalize_name(row['material'])
      raise ArgumentError, 'Retalho só pode ser usado em peças MDF.' if retalho?(result['material']) && result.fetch('construction_type','mdf') != 'mdf'
      if result.fetch('construction_type', 'mdf') == 'mdf' && retalho?(result['material'])
        result['material_policy'] = ANY_MDF
      else
        result.delete('material_policy')
      end
      result
    end
  end

  module Parameters
    # Shared with MyDinaPanel.MATERIAL_NAME_LIMIT. Identity is never truncated.
    MATERIAL_NAME_LIMIT = 128
    FOOT_DIAMETER = 15.0
    DEFAULTS = {
      'component_kind' => '', 'volume_bound' => false, 'name' => 'Novo Módulo', 'module_family' => 'cabinet', 'width' => 800.0, 'height' => 720.0, 'depth' => 450.0,
      'thickness' => 15.0, 'back' => true, 'back_thickness' => 6.0,
      'base_type' => 'under', 'top_type' => 'full', 'top_join' => 'over', 'rail_width' => 70.0,
      'bottom_type' => 'full', 'bottom_rail_width' => 70.0,
      'back_type' => 'applied', 'back_setback' => 10.0, 'back_groove_depth' => 5.0, 'back_panel_type' => 'full', 'back_rail_width' => 70.0,
      'material' => 'Branco TX', 'back_material' => 'Branco TX', 'apparent_material' => '', 'hidden_material' => 'Retalho',
      'layout' => { 'id' => 'root' }.freeze, 'opening_layouts' => [].freeze, 'opening_sequence' => 0, 'fronts' => [].freeze, 'claddings' => [].freeze,
      'reference_trims' => {}.freeze, 'trims' => [].freeze, 'accessories' => [].freeze, 'piece_settings' => {}.freeze, 'excluded_pieces' => [].freeze, 'joint_banding' => false
    }.freeze
    LIMITS = {
      'width' => [100, 4000, 'Largura'], 'height' => [100, 4000, 'Altura'],
      'depth' => [80, 1500, 'Profundidade'], 'thickness' => [6, 40, 'Espessura do MDF'],
      'back_thickness' => [3, 25, 'Espessura do fundo'],
      'back_setback' => [0, 300, 'Recuo do fundo'], 'back_groove_depth' => [0.1, 39, 'Profundidade do rasgo'], 'rail_width' => [30, 300, 'Largura das réguas'],
      'bottom_rail_width' => [30, 300, 'Largura das réguas da base'], 'back_rail_width' => [30, 300, 'Largura das réguas do fundo']
    }.freeze
    ASSEMBLY_DIMENSION_LIMITS = {
      'width' => [1, 10_000, 'Largura do módulo de peças'],
      'height' => [1, 10_000, 'Altura do módulo de peças'],
      'depth' => [1, 10_000, 'Profundidade do módulo de peças']
    }.freeze
    MM_DECIMALS = 1

    def self.clean_mm(value); Dimensions.mm(value); end

    def self.number(value, label, min, max)
      n=Dimensions.parse(value)
      n=Dimensions.mm(n) unless Dimensions.scalar?(label)
      raise ArgumentError, "#{label}: use um valor entre #{min} e #{max}." unless n.finite? && n.between?(min,max)
      n
    rescue ArgumentError => error
      raise error if error.message.start_with?(label.to_s+':')
      raise ArgumentError, "#{label}: informe um número válido."
    end

    def self.material_name(value, fallback = 'Branco TX')
      text = value.to_s.strip
      text = fallback.to_s.strip if text.empty?
      raise ArgumentError, "Use até #{MATERIAL_NAME_LIMIT} caracteres no material." if text.length > MATERIAL_NAME_LIMIT
      text = MaterialPolicy.normalize_name(text)
      %w[mdf mdf\ branco].include?(text.downcase) ? 'Branco TX' : text
    end

    def self.glass_material_name(color)
      {'clear'=>'Vidro Incolor','smoke'=>'Vidro Fumê','bronze'=>'Vidro Bronze','green'=>'Vidro Verde','mirror'=>'Espelho'}.fetch(color, 'Vidro Incolor')
    end

    # Persisted v0.1 modules keep their original construction, including missing MDF defaults.
    def self.from_saved(raw)
      raise ArgumentError, 'Dados do módulo inválidos.' unless raw.is_a?(Hash)
      raw = raw.merge('fronts'=>raw['fronts'].map { |front| front.is_a?(Hash) ? front.merge('face_recess'=>front.fetch('face_recess',0),'rear_clearance'=>front.fetch('rear_clearance',2)) : front }) if raw['fronts'].is_a?(Array)
      legacy = raw.key?('base_type') ? raw : raw.merge('base_type' => 'between', 'thickness' => raw.fetch('thickness', 18.0))
      normalize({ 'top_join' => 'between' }.merge(legacy), validate_stock: false, saved: true)
    end

    def self.normalize(raw, validate_stock: true, previous: nil, saved: false)
      raise ArgumentError, 'Não foi possível ler as medidas.' unless raw.is_a?(Hash)
      p = DEFAULTS.merge(raw.select { |key, _| DEFAULTS.key?(key) })
      p['joint_banding']=raw.fetch('joint_banding',Array(raw['claddings']).any? { |item| item.is_a?(Hash) && item['mode']=='thickened' })
      assembly_mode = raw.key?('assembly')
      p['module_family'] = raw.fetch('module_family', assembly_mode ? 'custom' : 'cabinet')
      p['volume_bound'] = raw['volume_bound'] == true
      unless (p['module_family'] == 'custom') == assembly_mode && %w[cabinet custom baseboard functional panel].include?(p['module_family'])
        raise ArgumentError, 'Família do módulo incompatível com sua receita.'
      end
      limits = assembly_mode ? LIMITS.merge(ASSEMBLY_DIMENSION_LIMITS) : LIMITS
      if p['module_family'] == 'functional'
        p['component_kind'] = raw.fetch('component_kind')
        raise ArgumentError, 'Componente avulso inválido.' unless %w[door drawer cladding crown baseboard].include?(p['component_kind'])
        limits = LIMITS.merge(ASSEMBLY_DIMENSION_LIMITS)
      end
      limits = limits.merge('height' => [20, 1000, 'Altura do rodapé']) if p['module_family'] == 'baseboard'
      limits = limits.merge('width'=>[1,1e9,'Largura do Painel'], 'height'=>[1,1e9,'Altura do Painel'], 'depth'=>[1,10000,'Profundidade do Painel']) if p['module_family']=='panel'
      limits.each do |key, (min, max, label)|
        p[key] = number(p[key], label, min, max)
        p[key] = clean_mm(p[key]) if assembly_mode && ASSEMBLY_DIMENSION_LIMITS.key?(key)
      end
      raise ArgumentError, 'A opção de fundo é inválida.' unless [true, false].include?(p['back'])
      raise ArgumentError, 'Fitagem conjunta inválida.' unless [true,false].include?(p['joint_banding'])
      { 'base_type' => %w[under between], 'top_type' => %w[full rails], 'bottom_type' => %w[full rails], 'back_panel_type' => %w[full rails], 'top_join' => %w[over between], 'back_type' => %w[applied inset groove] }.each do |key, values|
        raise ArgumentError, 'Opção de construção inválida.' unless values.include?(p[key])
      end
      p['name'] = p['name'].to_s.strip
      p['name'] = DEFAULTS['name'] if p['name'].empty?
      raise ArgumentError, 'Use até 60 caracteres nos nomes.' if p['name'].length > 60
      %w[material back_material].each do |key|
        p[key] = material_name(p[key], DEFAULTS[key])
        raise ArgumentError, "Use até #{MATERIAL_NAME_LIMIT} caracteres no material." if p[key].length > Parameters::MATERIAL_NAME_LIMIT
      end
      p['apparent_material'] = raw['apparent_material'].to_s.strip.empty? ? '' : material_name(raw['apparent_material'])
      raise ArgumentError, 'Nome do material muito longo.' if p['apparent_material'].length > Parameters::MATERIAL_NAME_LIMIT
      p['hidden_material'] = material_name(raw.fetch('hidden_material', 'Retalho'), 'Retalho')
      raise ArgumentError, 'Nome do material muito longo.' if p['hidden_material'].length > Parameters::MATERIAL_NAME_LIMIT
      p['piece_settings'] = normalize_piece_settings(p['piece_settings'], max: p['module_family']=='panel' ? Panel::MAX_PIECES : 1024)
      if p['module_family']=='panel'
        p['panel']=Panel.normalize(raw.fetch('panel',{}),p)
        channel=p['panel']['fixation']=='channel' && Panel.grid(p)['columns']>1
        p['depth']=(channel ? Panel.wall_reference(p) : Panel.back_depth(p))-Panel.front_depth(p)
        p['depth']+=p['panel']['mirror_thickness'] if p['panel']['mirror']!='none'
        p['back']=false
      end
      raise ArgumentError, 'Referência de acabamentos inválida.' unless p['reference_trims'].is_a?(Hash)
      p['reference_trims'] = p['reference_trims'].select { |key,_| %w[baseboard crown].include?(key) }.transform_values { |value| number(value, 'Cobertura de acabamento', 0, 10000) }
      unless p['excluded_pieces'].is_a?(Array) && p['excluded_pieces'].length <= 4096 &&
          p['excluded_pieces'].all? { |role| role.is_a?(String) && role.match?(/\A[a-zA-Z0-9_:\/-]{1,120}\z/) }
        raise ArgumentError, 'Lista de peças excluídas inválida.'
      end
      p['excluded_pieces'] = p['excluded_pieces'].uniq
      p['claddings'] = normalize_claddings(p['claddings'], p)
      p['trims'] = normalize_trims(p['trims'], p)
      if p['module_family'] == 'baseboard'
        raise ArgumentError, 'Configure um único rodapé estrutural avulso.' unless p['trims'].length == 1 && p['trims'][0]['kind'] == 'baseboard' && p['trims'][0]['structure_version'] == 1
        p['back'] = false
      end
      if raw.key?('cladding_overlap')
        overlap = raw['cladding_overlap']
        raise ArgumentError, 'Encontro dos tamponamentos inválido.' unless overlap.is_a?(Hash) && %w[top bottom].all? { |side| %w[horizontal sides].include?(overlap[side]) }
        p['cladding_overlap'] = { 'top' => overlap['top'], 'bottom' => overlap['bottom'] }
      end
      p['accessories'] = normalize_accessories(p['accessories'])
      if raw.key?('assembly')
        raise ArgumentError, 'Módulo de peças inválido.' unless raw['assembly'].is_a?(Array) && raw['assembly'].length <= 1024
        p['assembly'] = raw['assembly'].map do |entry|
          unless entry.is_a?(Hash) && %w[origin size].all? { |key| entry[key].is_a?(Array) && entry[key].length == 3 && entry[key].all? { |v| v.is_a?(Numeric) && v.finite? && v.abs <= 10000 } } && entry['size'].all? { |v| clean_mm(v) > 0 }
            raise ArgumentError, 'As medidas das peças deste módulo são inválidas.'
          end
          value = { 'name' => entry['name'].to_s[0,60],
            'origin' => entry['origin'].map { |v| clean_mm(v) },
            'size' => entry['size'].map { |v| clean_mm(v) } }
          if entry['reference']
            raise ArgumentError, 'Referência de medidas inválida.' unless entry['reference'].is_a?(Array) && entry['reference'].length == 3 && entry['reference'].all? { |n| n.is_a?(Numeric) && n.finite? && clean_mm(n) > 0 }
            value['reference'] = entry['reference'].map { |v| clean_mm(v) }; value['rule'] = Rules.normalize(entry['rule'] || {})
          end
          value
        end
      end
      p['layout'] = normalize_node(p['layout'], 'root', 0)
      p['opening_layouts'] = normalize_opening_layouts(p['opening_layouts'])
      sequence = p['opening_sequence']
      unless sequence.is_a?(Numeric) && sequence.finite? && sequence == sequence.to_i && sequence.between?(0, 9_007_199_254_740_990)
        raise ArgumentError, 'Sequência de identidade dos vãos inválida.'
      end
      p['opening_sequence'] = [sequence.to_i, *p['opening_layouts'].map { |entry| entry['id'].delete_prefix('space_').to_i }].max
      if p['module_family'] != 'cabinet' && !p['opening_layouts'].empty?
        raise ArgumentError, 'Divisões de vãos pertencem somente à caixaria.'
      end
      raise ArgumentError, 'Lista de frentes inválida.' unless p['fronts'].is_a?(Array) && p['fronts'].length <= 64
      p['fronts'] = p['fronts'].map { |f| normalize_front(f, p, saved: saved) }
      recalc_drawer_depth_on_cabinet_resize(p, previous) if previous && !saved
      if p['module_family'] == 'baseboard' && (!p['fronts'].empty? || p['layout']['split'] || !p['claddings'].empty?)
        raise ArgumentError, 'O rodapé avulso não recebe frentes, divisões ou tamponamentos de uma caixaria.'
      end
      if p['module_family']=='panel' && (!p['fronts'].empty? || p['layout']['split'] || !p['claddings'].empty? || !p['trims'].empty?)
        raise ArgumentError, 'Configure superfície, espelho e fixação na família Painel.'
      end
      if p.key?('assembly') && !p['fronts'].empty?
        raise ArgumentError, 'Um módulo de peças não pode conter uma receita de frentes sem validação de vãos.'
      end
      ids = p['fronts'].map { |f| f['id'] }
      raise ArgumentError, 'Identificação de frente repetida.' unless ids.uniq.length == ids.length
      result = layout(p, previous: previous)
      unless p.key?('assembly')
        active_roles = result['panels'].map { |piece| piece['role'] } + p['excluded_pieces']
        p['piece_settings'].select! { |role, _| active_roles.include?(role) }
      end
      if validate_stock && !p.key?('assembly')
        if defined?(MaterialCatalog)
          MaterialCatalog.with_operation_cache { PieceOrientation.validate_panels!(p, result['panels'], previous: previous) }
        else
          PieceOrientation.validate_panels!(p, result['panels'], previous: previous)
        end
      end
      Dimensions.canonical(p).merge('dimension_precision'=>1)
    end

    def self.normalize_node(node, id, depth)
      raise ArgumentError, 'A estrutura de vãos é inválida.' unless node.is_a?(Hash)
      raise ArgumentError, 'Use no máximo 16 níveis de divisões nesta versão.' if depth > 16
      result = { 'id' => id }
      if node['split']
        raise ArgumentError, 'Tipo de divisão inválido.' unless %w[horizontal vertical].include?(node['split'])
        ratio = Float(node.fetch('ratio', 0.5)) rescue nil
        raise ArgumentError, 'A proporção da divisão é inválida.' unless ratio && ratio.finite? && ratio.between?(0, 1)
        result.merge!('split' => node['split'], 'ratio' => ratio,
          'first' => normalize_node(node['first'], "#{id}/a", depth + 1),
          'second' => normalize_node(node['second'], "#{id}/b", depth + 1))
        if node['insertion_batch']
          batch = node['insertion_batch'].to_s
          raise ArgumentError, 'Identificação da inserção inválida.' unless batch.match?(/\A[a-zA-Z0-9_-]{1,48}\z/)
          result['insertion_batch'] = batch
        end
        if node.key?('keep_divider_proportions')
          raise ArgumentError, 'Proporção das divisórias inválida.' unless [true, false].include?(node['keep_divider_proportions'])
          result['keep_divider_proportions'] = node['keep_divider_proportions']
        end
        mode = node.fetch('position_mode', 'ratio')
        raise ArgumentError, 'Referência de posição inválida.' unless %w[ratio start end].include?(mode)
        result['position_mode'] = mode
        result['distance'] = number(node.fetch('distance', 100), 'Distância do vão', 0, 4000) unless mode == 'ratio'
      end
      result
    end

    def self.normalize_front(raw, p, saved: false)
      raise ArgumentError, 'Frente inválida.' unless raw.is_a?(Hash)
      f = { 'id' => raw['id'], 'kind' => raw.fetch('kind', 'door'), 'nodes' => raw['nodes'],
        'fit' => raw.fetch('fit', 'overlay'), 'material' => material_name(raw.fetch('material', p['material']), p['material']) }
      raise ArgumentError, 'Identificação da frente inválida.' unless f['id'].is_a?(String) && f['id'].match?(/\A[a-zA-Z0-9_-]{1,40}\z/)
      raise ArgumentError, 'Tipo de frente inválido.' unless %w[door drawers].include?(f['kind'])
      raise ArgumentError, 'Encaixe da frente inválido.' unless %w[overlay inset].include?(f['fit'])
      unless f['nodes'].is_a?(Array) && !f['nodes'].empty? && f['nodes'].length <= 128 && f['nodes'].all? { |n| n.is_a?(String) }
        raise ArgumentError, 'Escolha os vãos da frente.'
      end
      # A joined physical opening keeps its original construction references.
      f['nodes'] = f['nodes'].flat_map { |id| id.split('|') }.uniq
      raise ArgumentError, 'Escolha os vãos da frente.' if f['nodes'].length > 128
      f['side'] = raw.fetch('side', 'front')
      raise ArgumentError, 'Lado de inserção inválido.' unless %w[front rear].include?(f['side'])
      f['runner'] = raw.fetch('runner', 'telescopic')
      f['visibility'] = raw.fetch('visibility', 'external')
      unless %w[telescopic concealed custom].include?(f['runner']) && %w[external internal].include?(f['visibility'])
        raise ArgumentError, 'Configuração da gaveta inválida.'
      end
      f['recess'] = number(raw.fetch('recess', 22), 'Recuo da gaveta interna', 0, 300)
      f['face_recess'] = number(raw.fetch('face_recess', f['kind']=='drawers' ? 5 : 0), 'Recuo frontal', 0, 1500)
      f['door_type'] = raw.fetch('door_type', 'hinged')
      f['door_opening'] = raw.fetch('door_opening', 'left')
      f['lift_system'] = raw.fetch('lift_system', 'gas')
      raise ArgumentError, 'Sistema de basculante inválido.' unless %w[gas mechanical].include?(f['lift_system'])
      raise ArgumentError, 'Tipo de porta inválido.' unless %w[hinged lift sliding].include?(f['door_type'])
      raise ArgumentError, 'Abertura da porta inválida.' unless %w[left right double top bottom].include?(f['door_opening'])
      f['material'] = material_name(f['material'], p['material'])
      raise ArgumentError, 'Nome de material muito longo.' if f['material'].length > Parameters::MATERIAL_NAME_LIMIT
      f['count'] = number(raw.fetch('count', 1), 'Quantidade', 1, f['kind'] == 'door' ? (f['door_type']=='sliding' ? 4 : 3) : 8)
      raise ArgumentError, 'Quantidade deve ser inteira.' unless f['count'] == f['count'].to_i
      f['count'] = f['count'].to_i
      { 'gap' => [3, 0, Float::INFINITY, 'Folga entre frentes'], 'thickness' => [p['thickness'], 6, 40, 'Espessura da frente'],
        'slide_clearance' => [raw['hardware_layout_version'].to_i == 1 ? 14 : 13, 0, 50, 'Folga de cada corrediça'],
        'box_height' => [120, 40, 4000, 'Altura da caixa da gaveta'],
        'box_depth' => [350, 100, 1500, 'Profundidade da caixa da gaveta'] }.each do |key, (default, min, max, label)|
        f[key] = number(raw.fetch(key, default), label, min, max)
      end
      if f['kind'] == 'drawers'
        f['box_material'] = raw['box_material'].to_s.strip.empty? ? '' : material_name(raw['box_material'], p['material'])
        f['box_depth_auto'] = raw.fetch('box_depth_auto', true)
        raise ArgumentError, 'Ajuste automático da profundidade inválido.' unless [true, false].include?(f['box_depth_auto'])
        raise ArgumentError, 'Nome do MDF da caixa muito longo.' if f['box_material'].length > Parameters::MATERIAL_NAME_LIMIT
        # Old recipes remain readable; new writes require at least 10 mm.
        f['rear_clearance']=number(raw.fetch('rear_clearance',saved ? 2 : 10),'Folga traseira',saved ? 2 : 10,1500)
        f['hardware_layout_version'] = raw.fetch('hardware_layout_version', 0).to_i
        raise ArgumentError, 'Configuração da corrediça inválida.' unless [0, 1].include?(f['hardware_layout_version'])
        f['front_height_linked'] = raw.fetch('front_height_linked', f['hardware_layout_version'] == 1)
        raise ArgumentError, 'Vínculo da altura da gaveta inválido.' unless [true, false].include?(f['front_height_linked'])
        { 'runner_height' => [44, 20, 80, 'Altura da corrediça'],
          'runner_drop' => [10, 0, 40, 'Avanço da corrediça abaixo do fundo'],
          'base_clearance' => [10, 0, 80, 'Folga da primeira gaveta sobre a base'],
          'front_projection' => [15, 0, 80, 'Frente abaixo do fundo'] }.each do |key, (default, min, max, label)|
          default = f['runner_drop'] if key == 'base_clearance' && f['runner'] == 'telescopic' && f['hardware_layout_version'] == 1
          f[key] = number(raw.fetch(key, default), label, min, max)
        end
        if f['runner'] == 'telescopic' && f['hardware_layout_version'] == 1 && f['slide_clearance'] <= 0
          raise ArgumentError, 'A corrediça telescópica precisa de folga lateral maior que zero.'
        end
        if f['runner'] == 'telescopic' && f['hardware_layout_version'] == 1 && f['base_clearance'] != f['runner_drop']
          raise ArgumentError, 'A primeira corrediça deve ficar apoiada na base. Iguale a folga da primeira caixa ao avanço da corrediça.'
        end
        if f['runner'] == 'telescopic' && f['hardware_layout_version'] == 1 && f['runner_height'] <= 2 * f['runner_drop']
          raise ArgumentError, 'A altura da corrediça precisa ser maior que os espaços acima e abaixo do trilho móvel.'
        end
        # Existing recipes without this field keep their original panel heights.
        f['box_height_difference'] = number(raw.fetch('box_height_difference', 0), 'Diferença de altura da caixa', 0, 500)
      end
      { 'gap_left' => 'Folga esquerda', 'gap_right' => 'Folga direita',
        'gap_bottom' => 'Folga inferior', 'gap_top' => 'Folga superior' }.each do |key, label|
        f[key] = number(raw.fetch(key, f['gap']), label, -Float::INFINITY, Float::INFINITY)
      end
      FrontComponents.normalize(f,raw,p,saved)
    end

    def self.normalize_piece_settings(raw, max: 1024)
      raise ArgumentError, 'Fichas de peças inválidas.' unless raw.is_a?(Hash) && raw.length <= max
      raw.map do |role, data|
        raise ArgumentError, 'Identificação de peça inválida.' unless role.is_a?(String) && role.match?(/\A[a-zA-Z0-9_:\/-]{1,120}\z/)
        [role, normalize_piece(data)]
      end.to_h
    end

    # U/V are the two local panel axes, in XYZ order excluding thickness.
    def self.normalize_piece(raw)
      raise ArgumentError, 'Ficha de peça inválida.' unless raw.is_a?(Hash)
      data = {}
      if raw['texture_origin']
        value=raw['texture_origin']
        raise ArgumentError, 'Origem lógica da textura inválida.' unless value.is_a?(Array) && value.length==2 && value.all? { |n| n.is_a?(Numeric) && n.finite? && n.abs<=1e9 }
        data['texture_origin']=value.dup
      end
      data['machining']=Panel.normalize_machining(raw['machining']) if raw['machining']
      if raw['cut_orientation']
        raise ArgumentError, 'Orientação de corte inválida.' unless PieceOrientation::VALUES.include?(raw['cut_orientation'])
        data['cut_orientation'] = raw['cut_orientation']
      end
      if raw['name'] && !raw['name'].to_s.strip.empty?
        data['name'] = raw['name'].to_s.strip
        raise ArgumentError, 'Use até 60 caracteres no nome da peça.' if data['name'].length > 60
      end
      if raw['adjustment']
        value = raw['adjustment']
        raise ArgumentError, 'Ajuste da peça inválido.' unless value.is_a?(Hash) && %w[size offset].all? { |k| value[k].is_a?(Array) && value[k].length == 3 && value[k].all? { |v| v.is_a?(Numeric) && v.finite? && v.abs <= 4000 } }
        data['adjustment'] = value
      end
      data['thickness'] = number(raw['thickness'], 'Espessura da peça', 3, 40) if raw['thickness'] && raw['thickness'] != ''
      if raw['material'] && !raw['material'].to_s.strip.empty?
        data['material'] = material_name(raw['material'])
        raise ArgumentError, "Use até #{MATERIAL_NAME_LIMIT} caracteres no material." if data['material'].length > Parameters::MATERIAL_NAME_LIMIT
      end
      data['construction_type'] = raw.fetch('construction_type', 'mdf')
      data['material_policy'] = MaterialPolicy::ANY_MDF if MaterialPolicy.retalho?(data['material']) && data['construction_type']=='mdf'
      raise ArgumentError, 'Tipo construtivo da peça inválido.' unless %w[mdf glass].include?(data['construction_type'])
      data['fixation'] = raw.fetch('fixation', 'screw')
      raise ArgumentError, 'Fixação da peça inválida.' unless %w[screw dowel connector shelf_support angle].include?(data['fixation'])
      data['divider_mode'] = raw.fetch('divider_mode', 'internal')
      raise ArgumentError, 'Tipo de divisória inválido.' unless %w[internal batente].include?(data['divider_mode'])
      data['batente_depth'] = number(raw.fetch('batente_depth', 70), 'Profundidade do batente', 10, 1500)
      data['front_recess'] = number(raw.fetch('front_recess', 0), 'Recuo frontal', 0, 1500)
      data['glass_color'] = raw.fetch('glass_color', 'clear')
      raise ArgumentError, 'Cor do vidro inválida.' unless %w[clear smoke bronze green mirror white black].include?(data['glass_color'])
      data['led'] = raw.fetch('led', false)
      raise ArgumentError, 'Configuração de LED inválida.' unless [true, false].include?(data['led'])
      data['led_position'] = raw.fetch('led_position', 'front')
      raise ArgumentError, 'Posição do LED inválida.' unless %w[front center rear].include?(data['led_position'])
      data['grain'] = raw.fetch('grain', 'free')
      raise ArgumentError, 'Veio da peça inválido.' unless %w[free u v].include?(data['grain'])
      data['grain_angle'] = number(raw['grain_angle'], 'Ângulo do veio', -36000, 36000) % 360 if raw.key?('grain_angle')
      if raw.key?('edge_override')
        raise ArgumentError, 'Substituição manual de fitas inválida.' unless [true, false].include?(raw['edge_override'])
        data['edge_override'] = raw['edge_override']
      end
      edges = raw.fetch('edges', [])
      raise ArgumentError, 'Bordas da peça inválidas.' unless edges.is_a?(Array) && (edges - %w[u_min u_max v_min v_max]).empty?
      data['edges'] = edges.uniq.sort
      colors = raw.fetch('edge_materials', {})
      raise ArgumentError, 'Materiais de fita inválidos.' unless colors.is_a?(Hash) && (colors.keys - %w[u_min u_max v_min v_max]).empty?
      data['edge_materials'] = colors.map do |edge, name|
        raise ArgumentError, 'Nome de material da fita inválido.' unless name.is_a?(String) && !name.strip.empty? && name.length <= Parameters::MATERIAL_NAME_LIMIT
        [edge, material_name(name)] if data['edges'].include?(edge)
      end.compact.to_h unless colors.empty?
      if raw['face_materials']
        faces = raw['face_materials']
        raise ArgumentError, 'Materiais de superfície inválidos.' unless faces.is_a?(Hash) && (faces.keys - %w[face_min face_max u_min u_max v_min v_max]).empty?
        data['face_materials'] = faces.to_h do |surface, name|
          raise ArgumentError, 'Material de superfície inválido.' unless name.is_a?(String) && !name.strip.empty? && name.length <= Parameters::MATERIAL_NAME_LIMIT
          [surface, material_name(name)]
        end
        # Older brush versions saved MDF edge tape as a surface override.
        # Recover the recorded local side and its visible color, never face paint.
        if data['construction_type'] == 'mdf'
          painted_edges = data['face_materials'].keys & %w[u_min u_max v_min v_max]
          painted_edges.each do |edge|
            (data['edge_materials'] ||= {})[edge] = data['face_materials'].delete(edge)
          end
          unless painted_edges.empty?
            data['edges'] = (data['edges'] + painted_edges).uniq.sort
            data['edge_override'] = true
          end
        end
      end
      data['tape_thickness'] = number(raw.fetch('tape_thickness', 0.4), 'Espessura da fita', 0.1, 5)
      data['edge_decrement'] = raw.fetch('edge_decrement', false)
      raise ArgumentError, 'Desconto de fita inválido.' unless [true, false].include?(data['edge_decrement'])
      if data['construction_type'] == 'glass'
        data.merge!(Glass.normalize(raw))
        data['material'] = Glass.label(data)
        data['edges'] = []
        data.delete('edge_materials')
        data.delete('face_materials')
        data['grain'] = 'free'
        data.delete('grain_angle')
        data['led'] = false
        data['edge_decrement'] = false
      end
      Dimensions.canonical(data)
    end

    def self.thickness(p, role, fallback = nil)
      p.fetch('piece_settings', {}).fetch(role, {}).fetch('thickness', fallback || p['thickness'])
    end

    def self.split_distance(node, free)
      case node.fetch('position_mode', 'ratio')
      when 'start' then node['distance']
      when 'end' then free - node['distance']
      else free * node['ratio']
      end
    end

    # Reads preserve legacy references; only explicit writes collect dead trees.
    def self.normalize_opening_layouts(values)
      raise ArgumentError, 'Estrutura dos vãos livres inválida.' unless values.is_a?(Array) && values.length <= 128
      ids = []
      values.map do |value|
        raise ArgumentError, 'Referência do vão livre inválida.' unless value.is_a?(Hash) && value['id'].to_s.match?(/\Aspace_[1-9]\d{0,15}\z/) && value['id'].delete_prefix('space_').to_i <= 9_007_199_254_740_990 &&
          value['nodes'].is_a?(Array) && value['nodes'].length.between?(1, 128) && value['nodes'].all? { |id| id.is_a?(String) && id.match?(/\A(?:root|space_[1-9]\d{0,15})(?:\/[ab])*\z/) }
        raise ArgumentError, 'Identificação de vão repetida.' if ids.include?(value['id'])
        ids << value['id']
        {'id'=>value['id'], 'nodes'=>value['nodes'].uniq.sort, 'layout'=>normalize_node(value['layout'], value['id'], 0)}
      end
    end

    def self.find_node(node, id)
      if node.key?('layout')
        return find_node(node['layout'], id) || node.fetch('opening_layouts', []).filter_map { |entry| find_node(entry['layout'], id) }.first
      end
      return node if node['id'] == id
      return nil unless node['split']
      find_node(node['first'], id) || find_node(node['second'], id)
    end

    # Collect only proven dead structure. IDs of living/referenced regions stay
    # untouched; the caller persists this private result in its existing operation.
    def self.compact_openings(raw, protect: [], validate_stock: true, previous: nil)
      p = normalize(raw, validate_stock: validate_stock, previous: previous)
      return p unless p['module_family'] == 'cabinet' && !p.key?('assembly')
      before = layout(p)
      excluded = p['excluded_pieces']
      belongs = ->(id, root) { id == root || id.start_with?(root + '/') }
      dead = nil
      dead = ->(node) { !node['split'] || (excluded.include?('split:' + node['id']) && dead.call(node['first']) && dead.call(node['second'])) }
      covers = nil
      covers = ->(node, ids) { ids.include?(node['id']) || (node['split'] && covers.call(node['first'], ids) && covers.call(node['second'], ids)) }
      fixed = p['fronts'].flat_map { |front| front['nodes'] } + protect.flat_map { |id| id.split('|') }
      p['opening_layouts'].dup.reverse_each do |entry|
        next unless dead.call(entry['layout'])
        next if fixed.any? { |id| belongs.call(id, entry['id']) }
        consumers = p['opening_layouts'].reject { |other| other.equal?(entry) }.select { |other| other['nodes'].any? { |id| belongs.call(id, entry['id']) } }
        next unless consumers.all? { |other| covers.call(entry['layout'], other['nodes']) }
        consumers.each do |other|
          other['nodes'] = other['nodes'].flat_map { |id| belongs.call(id, entry['id']) ? entry['nodes'] : [id] }.uniq.sort
        end
        p['opening_layouts'].delete(entry)
      end
      references = fixed + p['opening_layouts'].flat_map { |entry| entry['nodes'] }
      prune = nil
      prune = lambda do |node|
        return unless node['split']
        if dead.call(node) && references.none? { |id| id.start_with?(node['id'] + '/') }
          id = node['id']; node.clear; node['id'] = id
        else
          prune.call(node['first']); prune.call(node['second'])
        end
      end
      prune.call(p['layout'])
      p['opening_layouts'].each { |entry| prune.call(entry['layout']) }
      p['excluded_pieces'] = excluded.reject do |role|
        role.start_with?('split:') && !find_node(p, role.delete_prefix('split:'))&.key?('split')
      end
      p['piece_settings'].delete_if do |role, _|
        role.start_with?('split:') && !find_node(p, role.delete_prefix('split:'))&.key?('split')
      end
      result = normalize(p, validate_stock: validate_stock, previous: previous)
      after = layout(result)
      unchanged = before['panels'] == after['panels'] && fixed.all? do |id|
        a, b = before['nodes'][id], after['nodes'][id]
        a && b && %w[id x z width height edges].all? { |key| a[key] == b[key] }
      end
      raise ArgumentError, 'A compactação alteraria uma peça ou referência válida.' unless unchanged
      result
    end

    def self.move_split(raw, id, mode, value)
      p = normalize(raw)
      node = find_node(p, id)
      raise ArgumentError, 'Escolha uma prateleira ou divisória.' unless node && node['split']
      node['position_mode'] = mode
      mode == 'ratio' ? node['ratio'] = number(value, 'Proporção', 0, 1) : node['distance'] = value
      normalize(p)
    end

    def self.division_id(p, id)
      return id if find_node(p, id)
      p['opening_layouts'].reverse.find { |entry| entry['nodes'].join('|') == id }.fetch('id')
    end

    def self.split(raw, id, axis)
      p = normalize(raw)
      available = windows(p)
      raise ArgumentError, 'Selecione um vão livre.' unless available.any? { |window| window['id'] == id }
      # One preparation can belong to a multi-opening insertion. Keep the other
      # selectable destinations resolvable until the complete recipe is stored.
      p = compact_openings(p, protect: available.map { |window| window['id'] })
      node = find_node(p, id)
      unless node
        next_id = p['opening_sequence'] + 1
        p['opening_sequence'] = next_id
        entry = {'id'=>"space_#{next_id}", 'nodes'=>id.split('|').sort, 'layout'=>{}}
        p['opening_layouts'] << entry
        node = entry['layout']
      end
      raise ArgumentError, 'Selecione um vão livre.' if node['split']
      node.merge!('split'=>axis, 'ratio'=>0.5, 'first'=>{}, 'second'=>{})
      node['keep_divider_proportions']=true
      normalize(p)
    end

    # Millimetres: Y=0 is the caixaria front, +Y rear, +Z up.
    # Depth includes the back; overlay fronts project ahead of the caixaria.
    def self.functional_layout(p)
      kind = p['component_kind']
      pieces = kind == 'cladding' ? cladding_panels(p) : %w[baseboard crown].include?(kind) ? trim_panels(p) : []
      region = {'id'=>'root', 'x'=>0.0, 'z'=>0.0, 'width'=>p['width'], 'height'=>p['height'], 'edges'=>[0,0,0,0], 'front'=>0.0, 'rear'=>p['depth'], 'depth'=>p['depth']}
      if %w[door drawer].include?(kind)
        p['fronts'].each { |front| add_front(p, front, region, p['depth'], pieces) }
      end
      pieces.each { |piece| piece['origin'][2] -= p['height'] } if kind == 'crown' && !p['volume_bound']
      pieces.each { |piece| finish_panel(p, piece) }
      finish_exposed_cladding_edges(p, pieces) if kind == 'cladding'
      pieces.reject! { |piece| p.fetch('excluded_pieces', []).include?(piece['role']) }
      {'panels'=>pieces, 'openings'=>%w[door drawer].include?(kind) ? [region] : [], 'nodes'=>{'root'=>region}}
    end

    # A batch is a same-axis chain in one bay; another bay is independent.
    def self.divider_chain(node)
      return [] unless node && %w[vertical horizontal].include?(node['split'])
      nodes=[node]; batch=node['insertion_batch']
      while batch && (child=nodes.last['second']) && child['split']==node['split'] && child['insertion_batch']==batch
        nodes << child
      end
      nodes
    end

    def self.proportional_dividers(p, node, span, reference)
      # Retain the saved flag name for compatibility; it covers both split axes.
      return unless reference && node['keep_divider_proportions'] && !reference[:handled].include?(node['id'])
      chain=divider_chain(node);reference[:handled].concat(chain.map { |item| item['id'] })
      old_node=find_node(reference[:params],node['id']);old_chain=divider_chain(old_node)
      return unless chain.map { |item| item['id'] }==old_chain.map { |item| item['id'] } && old_chain.all? { |item| item['keep_divider_proportions'] }
      return if chain.any? { |item| p['excluded_pieces'].include?('split:'+item['id']) }
      region=reference[:layout]['nodes'][node['id']]
      old_parts=chain.map { |item| reference[:layout]['panels'].find { |part| part['role']=='split:'+item['id'] } }
      return unless region && old_parts.all?
      axis, origin, dimension = node['split']=='horizontal' ? [2,'z','height'] : [0,'x','width']
      sizes=chain.map { |item| thickness(p,'split:'+item['id']) }
      return if (span-region[dimension]).abs<1e-7 && sizes.zip(old_parts).all? { |size,part| (size-part['size'][axis]).abs<1e-7 }
      cursor=region[origin];gaps=old_parts.map do |part|
        gap=part['origin'][axis]-cursor;cursor=part['origin'][axis]+part['size'][axis];gap
      end
      gaps << region[origin]+region[dimension]-cursor
      free=span-sizes.sum;total=gaps.sum
      raise ArgumentError, 'As peças ultrapassam o espaço disponível dos vãos.' if total<-1e-7 || free<0 || gaps.any? { |gap| gap<-1e-7 }
      weights=total>1e-7 ? gaps.map { |gap| gap.to_f/total } : Array.new(gaps.length,1.0/gaps.length)
      chain.each_with_index do |item,index|
        item['position_mode']='start';item['distance']=free*weights[index]
        data=p['piece_settings'].fetch('split:'+item['id'],{});adjustment=data['adjustment']
        if adjustment
          data['adjustment']=Marshal.load(Marshal.dump(adjustment));data['adjustment']['offset'][axis]=0
        end
      end
    end

    def self.set_divider_count(raw, id, count)
      p=normalize(raw);root=find_node(p,id);chain=divider_chain(root)
      raise ArgumentError, 'Quantidade de divisórias inválida.' unless count.is_a?(Integer) && count.between?(1,8) && !chain.empty?
      return p if count==chain.length
      axis=root['split'];physical_axis=axis=='horizontal' ? 2 : 0
      ids=chain.map { |node| node['id'] };region=layout(p)['nodes'][id]
      used=p['fronts'].any? { |front| front['nodes'].any? { |key| key==id || key.start_with?(id+'/') } } ||
        p['opening_layouts'].any? { |entry| entry['nodes'].any? { |key| key==id || key.start_with?(id+'/') } }
      if used || chain.any? { |node| node['first']['split'] } || chain.last['second']['split'] || ids.any? { |key| p['excluded_pieces'].include?('split:'+key) }
        raise ArgumentError, 'Para alterar a quantidade, remova antes as outras inserções deste conjunto de vãos.'
      end
      template=Marshal.load(Marshal.dump(p['piece_settings'].fetch('split:'+id,{})))
      old_settings=chain.map { |node| p['piece_settings'].fetch('split:'+node['id'],template) }
      batch=root['insertion_batch'] || 'div_'+id.tr('/','_');keep=root.fetch('keep_divider_proportions',false)
      chain.each { |node| p['piece_settings'].delete('split:'+node['id']) }
      node=root;new_nodes=[]
      count.times do |index|
        key=index.zero? ? id : new_nodes.last['id']+'/b'
        node.replace('id'=>key,'split'=>axis,'ratio'=>0.5,'position_mode'=>'start','distance'=>50,
          'insertion_batch'=>batch,'keep_divider_proportions'=>keep,'first'=>{'id'=>key+'/a'},'second'=>{'id'=>key+'/b'})
        new_nodes<<node;data=Marshal.load(Marshal.dump(old_settings[index]||template));data['adjustment']['offset'][physical_axis]=0 if data['adjustment']
        p['piece_settings']['split:'+key]=data;node=node['second']
      end
      gap=(region[axis=='horizontal' ? 'height' : 'width']-new_nodes.sum { |entry| thickness(p,'split:'+entry['id']) })/(count+1)
      raise ArgumentError, 'As divisórias ultrapassam o espaço disponível dos vãos.' if gap<-1e-7
      new_nodes.each { |entry| entry['distance']=gap }
      normalize(p)
    end

    def self.layout(p, previous: nil)
      Dimensions.layout(layout_exact(p, previous: previous))
    end

    def self.layout_exact(p, previous: nil)
      enabled=nil;enabled=->(node) { node && node['split'] && (node['keep_divider_proportions'] || enabled.call(node['first']) || enabled.call(node['second'])) }
      active=enabled.call(p['layout']) || p.fetch('opening_layouts',[]).any? { |entry| enabled.call(entry['layout']) }
      reference=active && previous && previous.fetch('module_family','cabinet')=='cabinet' && !previous.key?('assembly') ?
        {params:previous,layout:layout(Marshal.load(Marshal.dump(previous))),handled:[]} : nil
      return Panel.layout(p) if p['module_family']=='panel'
      return functional_layout(p) if p['module_family'] == 'functional'
      return { 'panels' => [], 'openings' => [], 'nodes' => {} } if p.key?('assembly')
      if p['module_family'] == 'baseboard'
        pieces = trim_panels(p)
        pieces.each do |piece|
          piece['origin'][2] += p['height']
          finish_panel(p, piece)
        end
        pieces.reject! { |piece| p.fetch('excluded_pieces', []).include?(piece['role']) }
        return { 'panels' => pieces, 'openings' => [], 'nodes' => {} }
      end
      w, h, d = p.values_at('width', 'height', 'depth')
      lt, rt = %w[left right].map { |role| thickness(p, role) }
      bt = thickness(p, p['bottom_type'] == 'rails' ? 'bottom:front' : 'bottom')
      if p['bottom_type'] == 'rails' && thickness(p, 'bottom:back') != bt
        raise ArgumentError, 'As duas réguas da base precisam ter a mesma espessura para apoiar as laterais.'
      end
      tt = thickness(p, p['top_type'] == 'full' ? 'top' : 'rail:front')
      if p['top_type'] == 'rails' && thickness(p, 'rail:back') != tt
        raise ArgumentError, 'As duas réguas superiores precisam ter a mesma espessura para apoiar as laterais.'
      end
      back_rails = p['back'] && p['back_panel_type'] == 'rails'
      b = p['back'] ? (back_rails ? [thickness(p, 'back:top'),thickness(p, 'back:bottom')].max : thickness(p, 'back', p['back_thickness'])) : 0.0
      applied = p['back'] && !back_rails && p['back_type'] == 'applied'
      grooved = p['back'] && !back_rails && p['back_type'] == 'groove'
      groove = grooved ? p['back_groove_depth'] : 0.0
      raise ArgumentError, 'A profundidade do rasgo precisa ser menor que a espessura das peças da caixaria.' if grooved && groove >= [lt,rt,bt,tt].min
      body_depth = applied ? d - b : d
      inner_depth = p['back'] ? d - b - (applied || back_rails ? 0 : p['back_setback']) : d
      raise ArgumentError, 'A profundidade livre do vão não pode ser negativa.' if inner_depth < 0
      under, over = p['base_type'] == 'under', p['top_join'] == 'over'
      side_h = h - (under ? bt : 0) - (over ? tt : 0)
      tx, tw = over ? [0, w] : [lt, w - lt - rt]
      pieces = [
        panel('left', 'Lateral esquerda', [0, 0, under ? bt : 0], [lt, body_depth, side_h], 0),
        panel('right', 'Lateral direita', [w - rt, 0, under ? bt : 0], [rt, body_depth, side_h], 0)
      ]
      bx, bw = under ? [0, w] : [lt, w - lt - rt]
      if p['bottom_type'] == 'full'
        pieces << panel('bottom', 'Base', [bx, 0, 0], [bw, body_depth, bt], 2)
      else
        r = p['bottom_rail_width']
        raise ArgumentError, 'As duas réguas da base não cabem na profundidade da caixaria.' if 2 * r > body_depth
        pieces << panel('bottom:front', 'Régua inferior frontal', [bx, 0, 0], [bw, r, bt], 2)
        pieces << panel('bottom:back', 'Régua inferior traseira', [bx, body_depth - r, 0], [bw, r, bt], 2)
      end
      if p['top_type'] == 'full'
        pieces << panel('top', 'Tampo', [tx, 0, h - tt], [tw, body_depth, tt], 2)
      else
        r = p['rail_width']
        raise ArgumentError, 'As duas réguas não cabem na profundidade da caixaria.' if 2 * r > body_depth
        pieces << panel('rail:front', 'Régua superior frontal', [tx, 0, h - tt], [tw, r, tt], 2)
        pieces << panel('rail:back', 'Régua superior traseira', [tx, body_depth - r, h - tt], [tw, r, tt], 2)
      end
      openings, nodes = [], {}
      walk(p, p['layout'], lt, bt, w - lt - rt, h - bt - tt, inner_depth, [lt, rt, bt, tt], pieces, openings, nodes, reference)
      if p['back']
        if back_rails
          r = p['back_rail_width']
          raise ArgumentError, 'As duas réguas do fundo não cabem na altura interna da caixaria.' if 2 * r > h - bt - tt
          pieces << panel('back:bottom', 'Régua do fundo inferior', [lt, d-thickness(p, 'back:bottom'), bt], [w - lt - rt, thickness(p, 'back:bottom'), r], 1)
          pieces << panel('back:top', 'Régua do fundo superior', [lt, d-thickness(p, 'back:top'), h - tt - r], [w - lt - rt, thickness(p, 'back:top'), r], 1)
        else
          pieces << (applied ? panel('back', 'Fundo sobreposto', [0, body_depth, 0], [w, b, h], 1) :
            panel('back', grooved ? 'Fundo embutido em rasgo' : 'Fundo interno', [lt - groove, inner_depth, bt - groove], [w - lt - rt + 2 * groove, b, h - bt - tt + 2 * groove], 1))
        end
      end
      if grooved
        roles = ['left','right',p['bottom_type']=='full' ? 'bottom' : 'bottom:back',p['top_type']=='full' ? 'top' : 'rail:back']
        pieces.select { |piece| roles.include?(piece['role']) && !p['excluded_pieces'].include?(piece['role']) }.each do |piece|
          offset = inner_depth - piece['origin'][1]
          raise ArgumentError, 'O recuo do fundo coloca o rasgo fora da base ou da parte superior. Ajuste o recuo ou a largura das réguas.' unless offset >= -1e-6 && offset + b <= piece['size'][1] + 1e-6
          piece['grooves'] = [{'direction'=>piece['thickness_axis']==0 ? 'vertical' : 'horizontal',
            'offset'=>[offset,0.0].max, 'width'=>b, 'depth'=>groove, 'logical_index'=>0,
            'face_axis'=>piece['thickness_axis'], 'face_sign'=>%w[left bottom bottom:back].include?(piece['role']) ? 1 : -1}]
        end
      end
      p.fetch('opening_layouts', []).each do |entry|
        selected = entry['nodes'].map { |id| nodes.fetch(id) { raise ArgumentError, 'Uma divisão ficou sem seu vão de referência.' } }
        x = selected.map { |r| r['x'] }.min; z = selected.map { |r| r['z'] }.min
        region = {'x'=>x, 'z'=>z, 'width'=>selected.map { |r| r['x']+r['width'] }.max-x, 'height'=>selected.map { |r| r['z']+r['height'] }.max-z}
        region['edges'] = [0,1,2,3].map do |edge|
          selected.select { |r| ([r['x']-x, r['x']+r['width']-x-region['width'], r['z']-z, r['z']+r['height']-z-region['height']][edge]).abs < 0.001 }.map { |r| r['edges'][edge] }.min
        end
        remaining = pieces.reject { |piece| p['excluded_pieces'].include?(piece['role']) }
        physical = remaining.map do |piece|
          value = Marshal.load(Marshal.dump(piece)); value['material'] ||= value['role'] == 'back' ? p['back_material'] : p['material']; finish_panel(p, value); value
        end
        # A later deletion may open an exterior side of this historical region.
        # Keep existing boards in place; windows() still requires real closure
        # before it offers any destination for another insertion.
        window = window_bounds(region, physical, remaining) || region.merge('front'=>0.0, 'rear'=>inner_depth, 'depth'=>inner_depth)
        raise ArgumentError, 'Uma divisão atravessa uma peça existente.' if physical.any? do |piece|
          [0,2].include?(piece['thickness_axis']) && rectangles_overlap?(window, {'x'=>piece['origin'][0], 'z'=>piece['origin'][2], 'width'=>piece['size'][0], 'height'=>piece['size'][2]})
        end
        sources = selected.flat_map { |r| r.fetch('source_nodes', [r['id']]) }.uniq
        openings.reject! { |r| rectangles_overlap?(region, r) }
        start = pieces.length
        walk(p, entry['layout'], window['x'], window['z'], window['width'], window['height'], window['depth'], region['edges'], pieces, openings, nodes, reference)
        pieces[start..-1].each { |piece| piece['origin'][1] += window['front'] }
        nodes.each_value { |r| r['source_nodes'] = sources if r['id'] == entry['id'] || r['id'].start_with?(entry['id']+'/') }
      end
      pieces.each { |piece| piece['material'] = piece['role'] == 'back' ? p['back_material'] : p['material'] }
      nominal = Marshal.load(Marshal.dump(pieces))
      pieces.each { |piece| finish_panel(p, piece) }
      # A horizontal split is sized from its enclosing bay, not from the
      # cabinet's global depth. A shallow/recessed batente remains a boundary
      # without turning the shelf into a narrow rail.
      pieces.each do |piece|
        next unless piece['role'].start_with?('split:') && piece['thickness_axis'] == 2
        next if p['excluded_pieces'].include?(piece['role'])
        region = nodes[piece['role'].delete_prefix('split:')]
        next unless region
        visible = pieces.reject { |board| p['excluded_pieces'].include?(board['role']) }
        visible_nominal = nominal.reject { |board| p['excluded_pieces'].include?(board['role']) }
        window = window_bounds(region, visible, visible_nominal)
        next unless window
        base = nominal.find { |board| board['role'] == piece['role'] }
        piece['origin'][1] += window['front'] - base['origin'][1]
        piece['size'][1] += window['depth'] - base['size'][1]
        raise ArgumentError, 'A prateleira ficou sem profundidade útil neste vão.' unless piece['size'][1] > 0
        base['origin'][1] = window['front']
        base['size'][1] = window['depth']
      end
      free_openings = merged_openings(openings, pieces, nominal, p['excluded_pieces'])
      p['fronts'].each do |f|
        region = front_region(f, nodes, openings, free_openings)
        visible = pieces.reject { |piece| p['excluded_pieces'].include?(piece['role']) }
        window = front_window(region, f['nodes'], nodes, visible, nominal)
        raise ArgumentError, 'As peças deste vão não têm fechamento e profundidade comuns.' unless window
        raise ArgumentError, 'Remova o fundo para inserir por trás da caixaria.' if f['side'] == 'rear' && p['back']
        generated = []
        back_panel = pieces.find { |piece| piece['role'] == 'back' }
        rear_limit = back_panel ? [window['rear'], back_panel['origin'][1]].min : window['rear']
        depth = rear_limit - window['front']
        add_front(p, f, region.merge(window), depth, generated)
        generated.each do |piece|
          piece['origin'][1] = f['side'] == 'rear' ? window['rear'] - piece['origin'][1] - piece['size'][1] : window['front'] + piece['origin'][1]
          finish_panel(p, piece)
          collision = pieces.any? do |other|
            other['role'].start_with?('front:') && 3.times.all? do |axis|
              [piece['origin'][axis]+piece['size'][axis],other['origin'][axis]+other['size'][axis]].min -
                [piece['origin'][axis],other['origin'][axis]].max > 1e-5
            end
          end
          raise ArgumentError, 'Os elementos inseridos se cruzam. Revise o recuo e a profundidade.' if collision
        end
        validate_drawer_panels!(f, region.merge(window), rear_limit, generated) if f['kind'] == 'drawers'
        pieces.concat(generated)
      end
      trim_panels(p).each { |piece| finish_panel(p, piece); pieces << piece }
      cladding_panels(p).each { |piece| finish_panel(p, piece); pieces << piece }
      finish_exposed_cladding_edges(p, pieces)
      # Keep construction references for the remaining boards and fronts, while
      # omitting only the physical boards explicitly removed by the user.
      pieces.reject! { |piece| p.fetch('excluded_pieces', []).include?(piece['role']) }
      { 'panels' => pieces, 'openings' => free_openings, 'nodes' => nodes, 'nominal_panels' => nominal }
    end

    def self.finish_exposed_cladding_edges(p, pieces)
      claddings = pieces.select { |piece| piece['role'].start_with?('cladding:') }
      claddings.each do |piece|
        data = piece['settings']
        next if data['edge_override'] || data['construction_type'] == 'glass'
        axis = piece['thickness_axis']
        edges = []
        if axis == 0
          # Side cladding exposes the front and rear, never its top/bottom ends.
          edges << 'u_min' unless piece['role'].include?(':rear:')
          edges << 'u_max' unless piece['role'].include?(':front:')
          data['edges'] = edges
          data['edge_materials'] = edges.to_h { |edge| [edge, piece['material']] }
          p['piece_settings'][piece['role']] = data
          next
        end
        edges << 'v_min' unless piece['role'].include?(':rear:')
        other_axis = axis == 0 ? 2 : 0
        %w[min max].each do |end_name|
          boundary = piece['origin'][other_axis] + (end_name == 'max' ? piece['size'][other_axis] : 0)
          covered = claddings.any? do |other|
            next false if other.equal?(piece)
            adjoining = end_name == 'max' ? other['origin'][other_axis] : other['origin'][other_axis] + other['size'][other_axis]
            next false unless (adjoining - boundary).abs < 0.001
            [0, 1, 2].reject { |i| i == other_axis }.all? do |i|
              other['origin'][i] <= piece['origin'][i] + 0.001 &&
                other['origin'][i] + other['size'][i] >= piece['origin'][i] + piece['size'][i] - 0.001
            end
          end
          edges << "#{axis == 0 ? 'v' : 'u'}_#{end_name}" unless covered
        end
        data['edges'] = edges
        data['edge_materials'] = edges.to_h { |edge| [edge, piece['material']] }
        p['piece_settings'][piece['role']] = data
      end
    end

    FRONT_EDGES = %w[u_min u_max v_min v_max].freeze
    NON_FRONT_SUFFIXES = %w[bottom left right inner rear].freeze

    def self.carcass_front_edge(piece)
      role = piece['role']
      return 'u_min' if %w[left right].include?(role)
      return 'v_min' if %w[bottom top rail:front rail:back bottom:front bottom:back].include?(role)
      return piece['thickness_axis'] == 0 ? 'u_min' : 'v_min' if role.start_with?('split:')
      nil
    end

    def self.front_panel_role?(role)
      value = role.to_s
      value.start_with?('front:') && !NON_FRONT_SUFFIXES.include?(value.split(':').last)
    end

    def self.finish_panel(p, piece)
        defaults={}
        defaults['construction_type']=piece['default_construction_type'] if piece['default_construction_type']
        defaults['glass_model']=piece['default_glass_model'] if piece['default_glass_model']
        data = normalize_piece(defaults.merge(p.fetch('piece_settings', {}).fetch(piece['role'], {})))
        data['edges'] = FRONT_EDGES.dup if front_panel_role?(piece['role']) && !data['edge_override'] && data['construction_type'] != 'glass'
        piece['name'] = data['name'] if data['name']
        piece['material'] = data.fetch('material', piece['material'])
        if %w[trim:baseboard trim:baseboard:back].include?(piece['role']) && !data['edge_override'] && data['construction_type'] != 'glass'
          trim = p.fetch('trims', []).find { |item| item['kind'] == 'baseboard' && item['structure_version'] == 1 }
          if trim
            # U is physical X on these boards; front/back cover the side rail ends.
            data['edges'] = %w[left right].each_with_index.filter_map do |side, index|
              "u_#{index == 0 ? 'min' : 'max'}" if trim["finish_#{side}"] && !p.fetch('excluded_pieces', []).include?("trim:baseboard:#{side}")
            end
            colors = data.fetch('edge_materials', {})
            data['edge_materials'] = data['edges'].to_h { |edge| [edge, colors.fetch(edge, piece['material'])] }
            data.delete('edge_materials') if data['edges'].empty?
          end
        end
        if (edge = carcass_front_edge(piece)) && !data['edge_override'] && data['construction_type'] != 'glass'
          data['edges'] = [edge]
          data['edge_materials'] = { edge => %w[rail:back bottom:back].include?(piece['role']) ? p['material'] : piece['material'] }
        end
        if piece['role'].match?(/\Afront:[^:]+:\d+:(left|right|inner|rear)\z/) && !data['edge_override'] && data['construction_type'] != 'glass'
          data['edges'] = ['v_max'] # The second in-plane axis is vertical on all four box walls.
          data['edge_materials'] = { 'v_max' => piece['material'] }
        end
        if piece['default_edges'] && !data['edge_override'] && data['construction_type']=='mdf'
          data['edges']=piece['default_edges'].dup
          data['edge_materials']=data['edges'].to_h { |edge| [edge,piece['material']] }
        end
        piece['settings'] = data
        if data['machining'] && data['machining']['grooves'].any? { |g| [0,2].include?(g['face_axis']) }
          data.delete('machining')
        end
        data['machining'] = {'kind'=>'grooves','grooves'=>piece['grooves']} if piece['grooves']
        if data['front_recess'].to_f > 0
          piece['origin'][1] += data['front_recess']
          piece['size'][1] -= data['front_recess']
        end
        if data['adjustment']
          piece['size'] = piece['size'].zip(data['adjustment']['size']).each_with_index.map { |(a,b),i| i == piece['thickness_axis'] ? a : a+b }
          piece['origin'] = piece['origin'].zip(data['adjustment']['offset']).map { |a,b| a+b }
        end
        raise ArgumentError, "#{piece['name']}: medidas insuficientes para esta montagem." unless piece['size'].all? { |v| v > 0 }
        uv = piece['size'].each_with_index.reject { |_,i| i == piece['thickness_axis'] }.map(&:first)
        data['cut_orientation'] = PieceOrientation.initial(uv, data['cut_orientation'])
        p['piece_settings'][piece['role']] = data
      piece
    end

    def self.rectangles_overlap?(a, b)
      [a['x'] + a['width'], b['x'] + b['width']].min - [a['x'], b['x']].max > 1e-7 &&
        [a['z'] + a['height'], b['z'] + b['height']].min - [a['z'], b['z']].max > 1e-7
    end

    def self.front_region(f, nodes, openings, free_openings = openings)
      selected = f['nodes'].map do |id|
        nodes.fetch(id) { raise ArgumentError, 'Uma frente ficou sem seu vão. Remova essa frente antes de remover a divisão.' }
      end
      x, z = selected.map { |r| r['x'] }.min, selected.map { |r| r['z'] }.min
      region = { 'x' => x, 'z' => z, 'width' => selected.map { |r| r['x'] + r['width'] }.max - x,
        'height' => selected.map { |r| r['z'] + r['height'] }.max - z }
      region['edges'] = [selected.select { |v| (v['x'] - x).abs < 1e-7 }.map { |v| v['edges'][0] }.min,
        selected.select { |v| (v['x'] + v['width'] - x - region['width']).abs < 1e-7 }.map { |v| v['edges'][1] }.min,
        selected.select { |v| (v['z'] - z).abs < 1e-7 }.map { |v| v['edges'][2] }.min,
        selected.select { |v| (v['z'] + v['height'] - z - region['height']).abs < 1e-7 }.map { |v| v['edges'][3] }.min]
      openings.each do |o|
        next unless rectangles_overlap?(region, o)
        unless f['nodes'].any? { |id| o['id'] == id || o['id'].start_with?(id + '/') } ||
            o.fetch('source_nodes', []).all? { |source| f['nodes'].any? { |id| source == id || source.start_with?(id+'/') } } && o.key?('source_nodes')
          raise ArgumentError, 'Escolha vãos vizinhos que formem um retângulo completo para a frente.'
        end
      end
      free = free_openings.any? { |o| o['id'].split('|').sort == f['nodes'].sort }
      if (f['kind'] == 'drawers' || f['fit'] == 'inset') && !free
        raise ArgumentError, 'Gavetas e frentes embutidas precisam de um único vão livre.'
      end
      region
    end

    def self.add_front(p, f, r, depth, pieces)
      if FrontComponents.advanced?(p,f)
        pieces.concat(FrontComponents.panels(p,f,r,depth))
        return
      end
      t, g, ft = p['thickness'], f['gap'], f['thickness']
      gl, gr, gb, gt = f.values_at('gap_left', 'gap_right', 'gap_bottom', 'gap_top')
      x, z, rw, rh = r.values_at('x', 'z', 'width', 'height')
      le, re, be, te = r['edges']
      if f['fit'] == 'overlay'
        x0 = (x - thickness(p, 'left')).abs < 1e-7 ? gl : x - le / 2 + gl / 2
        z0 = (z - thickness(p, p['bottom_type'] == 'rails' ? 'bottom:front' : 'bottom')).abs < 1e-7 ? gb : z - be / 2 + gb / 2
        x1 = (x + rw - (p['width'] - thickness(p, 'right'))).abs < 1e-7 ? p['width'] - gr : x + rw + re / 2 - gr / 2
        z1 = (z + rh - (p['height'] - thickness(p, p['top_type'] == 'full' ? 'top' : 'rail:front'))).abs < 1e-7 ? p['height'] - gt : z + rh + te / 2 - gt / 2
        y = -ft - 2
      else
        x0, z0, x1, z1, y = x + gl, z + gb, x + rw - gr, z + rh - gt, 0
      end
      fw, fh, count = x1 - x0, z1 - z0, f['count']
      prefix = "front:#{f['id']}"
      if f['kind'] == 'door'
        # front_region already requires one physically free opening for inset fronts.
        if f['door_type'] == 'lift'
          leaf_h = (fh - (count - 1) * g) / count
          raise ArgumentError, 'A porta basculante ficou pequena demais.' if fw < 50 || leaf_h < 50
          count.times do |i|
            pt = thickness(p, "#{prefix}:#{i}", ft)
            py = f['fit'] == 'overlay' ? -pt - 2 : 0
            raise ArgumentError, 'A porta embutida é mais profunda que o vão.' if f['fit'] == 'inset' && pt > depth
            pieces << panel("#{prefix}:#{i}", count == 1 ? 'Porta basculante' : "Porta basculante #{i + 1}",
              [x0, py, z0 + i * (leaf_h + g)], [fw, pt, leaf_h], 1, f['material'])
          end
        else
          leaf_w = (fw - (count - 1) * g) / count
          raise ArgumentError, 'A porta ficou pequena demais.' if leaf_w < 50 || fh < 50
          label = f['door_type'] == 'sliding' ? 'Porta de correr' : 'Porta de giro'
          count.times do |i|
            pt = thickness(p, "#{prefix}:#{i}", ft)
            py = f['fit'] == 'overlay' ? -pt - 2 : 0
            raise ArgumentError, 'A porta embutida é mais profunda que o vão.' if f['fit'] == 'inset' && pt > depth
            pieces << panel("#{prefix}:#{i}", count == 1 ? label : "#{label} #{i + 1}",
              [x0 + i * (leaf_w + g), py, z0], [leaf_w, pt, fh], 1, f['material'])
          end
        end
      else
        front_h = (fh - (count - 1) * g) / count
        box_w, box_h, box_d = rw - 2 * f['slide_clearance'], f['box_height'], f['box_depth']
        box_material = f['box_material'].to_s.empty? ? p['material'] : f['box_material']
        box_bottom_material = f['box_material'].to_s.empty? ? p['back_material'] : f['box_material']
        raise ArgumentError, 'As folgas deixam as frentes pequenas demais para este vão.' if (f['hardware_layout_version'] == 0 && !f['front_height_linked'] && box_h + 10 > rh / count) || front_h < 50 || fw < 50
        first_bottom = z + (f['hardware_layout_version'] == 1 && f['runner'] == 'telescopic' ? f['runner_drop'] : f['base_clearance'])
        overlay_projection = first_bottom - z0
        bottoms = count.times.map do |index|
          face_bottom = z0 + index * (front_h + g)
          if f['hardware_layout_version'] == 1
            if index == 0
              first_bottom
            elsif f['fit'] == 'overlay'
              face_bottom + overlay_projection
            else
              [z + index * rh / count + 5, face_bottom + f['front_projection']].max
            end
          else
            z + index * rh / count + 5
          end
        end
        if f['front_height_linked'] && f['visibility'] != 'internal'
          available = count.times.map do |index|
            face_top = z0 + (index + 1) * front_h + index * g
            next_bottom = index + 1 == count ? z + rh - 10 : bottoms[index + 1] - 2
            [front_h, face_top - bottoms[index], next_bottom - bottoms[index]].min
          end.min
          box_h = [box_h, available].min
          raise ArgumentError, 'As frentes não deixam altura suficiente para as caixas das gavetas.' if box_h < 40
          f['box_height'] = box_h
        end
        count.times do |i|
          face_bottom = z0 + i * (front_h + g)
          dz = bottoms[i]
          dx = x + f['slide_clearance']
          if f['hardware_layout_version'] == 1 || f['front_height_linked']
            next_bottom = i + 1 == count ? z + rh : bottoms[i + 1]
            clearance = i + 1 == count ? 10 : 2
            raise ArgumentError, "Gaveta #{i + 1}: reduza a altura da caixa para caber no vão." if dz + box_h > next_bottom - clearance + 0.001
            if f['hardware_layout_version'] == 1 && i > 0 && face_bottom - g > dz - f['runner_drop'] + 0.001
              raise ArgumentError, "Gaveta #{i}: a frente encosta na corrediça da gaveta acima. Aumente o desnível."
            end
          end
          role = "#{prefix}:#{i}"
          bt = thickness(p, "#{role}:bottom", p['back_thickness'])
          lt, rt, it, et = %w[left right inner rear].map { |suffix| thickness(p, "#{role}:#{suffix}") }
          pt = thickness(p, "#{role}:face", ft)
          attached_face = f['hardware_layout_version'] == 1 && f['visibility'] != 'internal'
          face_recess = f['fit']=='inset' ? f.fetch('face_recess',0) : 0
          py = f['fit'] == 'overlay' ? -pt - (attached_face ? 0 : 2) : face_recess
          by = drawer_box_start(f,pt)
          inner_height = box_h - f['box_height_difference'] - bt
          validate_drawer_space!(i, box_w - lt - rt, box_d - it - et, inner_height, box_d, by, depth, f['rear_clearance'])
          pieces << panel("#{role}:face", "Frente da gaveta #{i + 1}", [x0, py, z0 + i * (front_h + g)], [fw, pt, front_h], 1, f['material']) unless f['visibility'] == 'internal'
          pieces << panel("#{role}:bottom", "Fundo da gaveta #{i + 1}", [dx, by, dz], [box_w, box_d, bt], 2, box_bottom_material)
          pieces << panel("#{role}:left", "Lateral esquerda da gaveta #{i + 1}", [dx, by, dz + bt], [lt, box_d, box_h - bt], 0, box_material)
          pieces << panel("#{role}:right", "Lateral direita da gaveta #{i + 1}", [dx + box_w - rt, by, dz + bt], [rt, box_d, box_h - bt], 0, box_material)
          pieces << panel("#{role}:inner", "Frente interna da gaveta #{i + 1}", [dx + lt, by, dz + bt], [box_w - lt - rt, it, inner_height], 1, box_material)
          pieces << panel("#{role}:rear", "Traseira da gaveta #{i + 1}", [dx + lt, by + box_d - et, dz + bt], [box_w - lt - rt, et, inner_height], 1, box_material)
        end
      end
    end

    def self.drawer_box_start(front,face_thickness=front['thickness'])
      return front['recess'] if front['visibility']=='internal'
      spacer=front['hardware_layout_version']==1 ? 0 : 2
      front['fit']=='inset' ? front.fetch('face_recess',0)+face_thickness+spacer : spacer
    end

    # Recalculate automatic drawer boxes on an actual cabinet depth change.
    # Use the enclosing physical opening, preserving manually specified depths.
    def self.recalc_drawer_depth_on_cabinet_resize(params, previous)
      return unless params['module_family']=='cabinet'
      front_keys=%w[nodes side fit thickness face_recess recess visibility rear_clearance runner slide_clearance hardware_layout_version box_depth_auto]
      changed_space=%w[depth back back_type back_thickness back_setback back_groove_depth back_panel_type piece_settings excluded_pieces layout opening_layouts].any? { |key| params[key]!=previous[key] }
      affected=params['fronts'].select { |f| f['kind']=='drawers' && f['box_depth_auto']!=false }
      return if affected.empty?
      empty=params.merge('fronts'=>[])
      space=layout(empty)
      visible=space['panels'].reject { |piece| params['excluded_pieces'].include?(piece['role']) }
      affected.each do |front|
        old=previous.fetch('fronts',[]).find { |f| f['id']==front['id'] && f['kind']=='drawers' }
        next unless old
        changed_front=front_keys.any? { |key| front[key]!=old[key] }
        next unless changed_space || changed_front
        next if (front['box_depth']-old['box_depth']).abs>1e-7
        next unless front['nodes'].length==1 && space['nodes'][front['nodes'][0]]
        region=space['nodes'][front['nodes'][0]]
        window=front_window(region,front['nodes'],space['nodes'],visible,space['nominal_panels'])
        raise ArgumentError, 'A gaveta não possui um vão fechado para recalcular a profundidade.' unless window
        back=visible.find { |piece| piece['role']=='back' }
        rear_limit=back ? [window['rear'],back['origin'][1]].min : window['rear']
        start=drawer_box_start(front,thickness(params,"front:#{front['id']}:0:face",front['thickness']))
        available=rear_limit-window['front']-start-front['rear_clearance']
        unless changed_front
          old_space ||= layout(previous.merge('fronts'=>[]))
          old_visible=old_space['panels'].reject { |piece| previous['excluded_pieces'].include?(piece['role']) }
          old_region=old_space['nodes'][old['nodes'][0]]
          old_window=old_region && front_window(old_region,old['nodes'],old_space['nodes'],old_visible,old_space['nominal_panels'])
          if old_window
            old_back=old_visible.find { |piece| piece['role']=='back' }
            old_limit=old_back ? [old_window['rear'],old_back['origin'][1]].min : old_window['rear']
            old_start=drawer_box_start(old,thickness(previous,"front:#{old['id']}:0:face",old['thickness']))
            next if (available-(old_limit-old_window['front']-old_start-old['rear_clearance'])).abs<1e-7
          end
        end
        raise ArgumentError, 'A profundidade útil do módulo não comporta a caixa da gaveta (mínimo de 100 mm).' if available<100-1e-7
        if front['runner']=='telescopic'
          nominal=FrontComponents::RUNNER_LENGTHS.select { |length| length<=available+1e-7 }.max
          raise ArgumentError,'Nenhum comprimento de corrediça cabe na profundidade disponível.' unless nominal
          front['box_depth']=nominal
        else
          front['box_depth']=[1500,(available+1e-7).floor(3)].min
        end
      end
    end

    def self.measure(value)
      format('%.3f', value).sub(/0+\z/, '').sub(/\.\z/, '').tr('.', ',')
    end

    def self.validate_drawer_space!(index, width, depth, height, box_depth, recess, available, clearance=10)
      label = "Gaveta #{index + 1}"
      [[width, 50, 'a largura interna da caixa'],
       [depth, 50, 'a profundidade interna entre frente e traseira'],
       [height, 20, 'a altura útil da caixa']].each do |value, minimum, description|
        if value < minimum - 1e-6
          raise ArgumentError, "#{label}: #{description} ficou com #{measure(value)} mm. O mínimo é #{minimum} mm."
        end
      end
      if recess + box_depth > available - clearance + 1e-6
        raise ArgumentError, "#{label}: caixa de #{measure(box_depth)} mm + recuo de #{measure(recess)} mm não cabe nos #{measure(available)} mm de profundidade útil do vão, reservando #{clearance} mm atrás."
      end
    end

    # Check the final panels too: individual adjustments run after add_front.
    # Convert rear-facing drawers to the same local front-to-back coordinate.
    def self.validate_drawer_panels!(front, window, rear_limit, panels)
      front['count'].times do |index|
        prefix = "front:#{front['id']}:#{index}:"
        box = panels.select { |piece| piece['role'].start_with?(prefix) && !piece['role'].end_with?(':face') }.map do |piece|
          p = Marshal.load(Marshal.dump(piece))
          p['origin'][1] = front['side'] == 'rear' ? window['rear'] - p['origin'][1] - p['size'][1] : p['origin'][1] - window['front']
          p
        end
        by_role = box.to_h { |p| [p['role'].split(':').last, p] }
        edge = lambda { |name, axis, far| p = by_role.fetch(name); p['origin'][axis] + (far ? p['size'][axis] : 0) }
        width = edge.call('right', 0, false) - edge.call('left', 0, true)
        depth = edge.call('rear', 1, false) - edge.call('inner', 1, true)
        height = %w[left right inner rear].map { |name| edge.call(name, 2, true) }.min - edge.call('bottom', 2, true)
        start = box.map { |p| p['origin'][1] }.min
        stop = box.map { |p| p['origin'][1] + p['size'][1] }.max
        validate_drawer_space!(index, width, depth, height, stop - start, start, rear_limit - window['front'], front['rear_clearance'])
        outside = box.any? do |p|
          p['origin'][0] < window['x'] - 1e-6 || p['origin'][0] + p['size'][0] > window['x'] + window['width'] + 1e-6 ||
            p['origin'][2] < window['z'] - 1e-6 || p['origin'][2] + p['size'][2] > window['z'] + window['height'] + 1e-6 || p['origin'][1] < -1e-6
        end
        raise ArgumentError, "Gaveta #{index + 1}: uma peça ajustada ultrapassa os limites úteis do vão." if outside
        overlap = box.combination(2).any? do |a, b|
          3.times.all? do |axis|
            [a['origin'][axis] + a['size'][axis], b['origin'][axis] + b['size'][axis]].min - [a['origin'][axis], b['origin'][axis]].max > 1e-6
          end
        end
        raise ArgumentError, "Gaveta #{index + 1}: as peças ajustadas da caixa se sobrepõem. Revise medidas e posições." if overlap
      end
    end

    def self.walk(p, node, x, z, width, height, depth, edges, pieces, openings, nodes, reference = nil)
      if width < -1.0e-7 || height < -1.0e-7
        raise ArgumentError, 'A medida livre do vão não pode ser negativa.'
      end
      region = { 'id' => node['id'], 'x' => x, 'z' => z, 'width' => width, 'height' => height, 'edges' => edges }
      nodes[node['id']] = region
      unless node['split']
        openings << region
        return
      end
      t = thickness(p, "split:#{node['id']}")
      proportional_dividers(p,node,node['split']=='horizontal' ? height : width,reference)
      le, re, be, te = edges
      if node['split'] == 'horizontal'
        lower = split_distance(node, height - t)
        pieces << panel("split:#{node['id']}", 'Prateleira', [x, 0, z + lower], [width, depth, t], 2)
        walk(p, node['first'], x, z, width, lower, depth, [le, re, be, t], pieces, openings, nodes, reference)
        walk(p, node['second'], x, z + lower + t, width, height - lower - t, depth, [le, re, t, te], pieces, openings, nodes, reference)
      else
        left = split_distance(node, width - t)
        data = p.fetch('piece_settings', {}).fetch("split:#{node['id']}", {})
        batente = data['divider_mode'] == 'batente'
        part_depth = batente ? data.fetch('batente_depth', 70) + data.fetch('front_recess', 0) : depth
        raise ArgumentError, 'O batente é mais profundo que o vão.' if part_depth > depth + 1e-6
        piece = panel("split:#{node['id']}", batente ? 'Batente frontal' : 'Divisória', [x + left, 0, z], [t, part_depth, height], 0)
        # The short physical batente must not shorten the bay. Its virtual rear
        # plane stays at the carcass rear even when the batente is recessed.
        piece['opening_depth'] = depth - data.fetch('front_recess', 0) if batente
        pieces << piece
        walk(p, node['first'], x, z, left, height, depth, [le, t, be, te], pieces, openings, nodes, reference)
        walk(p, node['second'], x + left + t, z, width - left - t, height, depth, [t, re, be, te], pieces, openings, nodes, reference)
      end
    end

    def self.has_side_claddings?(p)
      p.fetch('claddings', []).any? { |value| %w[left right].include?(value['side']) }
    end

    def self.baseboard_side_setbacks(p, value)
      covered = value['cover_cladding'] != false && has_side_claddings?(p)
      covered ? [0, 0] : [value.fetch('setback_left', 0), value.fetch('setback_right', 0)]
    end

    def self.normalize_trims(raw, p)
      raise ArgumentError, 'Lista de rodapés/rodatetos inválida.' unless raw.is_a?(Array) && raw.length <= 2
      result = raw.map do |value|
        raise ArgumentError, 'Acabamento inválido.' unless value.is_a?(Hash)
        if p['module_family'] == 'baseboard' || p['module_family'] == 'functional' && p['component_kind'] == 'crown' && !p['volume_bound']
          value = value.merge('height' => p['height'], 'thickness' => p['thickness'],
            'setback' => 0, 'setback_back' => 0, 'setback_left' => 0, 'setback_right' => 0, 'cover_cladding' => false)
        end
        kind = value.fetch('kind', 'baseboard')
        raise ArgumentError, 'Tipo de acabamento inválido.' unless %w[baseboard crown].include?(kind)
        material = material_name(value.fetch('material', p['material']), p['material'])
        raise ArgumentError, 'Nome do material muito longo.' if material.length > Parameters::MATERIAL_NAME_LIMIT
        item = {
          'kind' => kind,
          'height' => number(value.fetch('height', 100), 'Altura do acabamento', 20, 1000),
          'thickness' => number(value.fetch('thickness', p['thickness']), 'Espessura do acabamento', 6, 40),
          'setback' => number(value.fetch('setback', kind == 'baseboard' ? 50 : 0), 'Recuo do acabamento', 0, 500),
          'material' => material
        }
        if value.key?('cover_cladding')
          raise ArgumentError, 'Cobertura pelo tamponamento inválida.' unless [true, false].include?(value['cover_cladding'])
          item['cover_cladding'] = value['cover_cladding']
        end
        if kind == 'baseboard' && value['structure_version'] == 1
          item['structure_version'] = 1
          item['foot_height'] = number(value.fetch('foot_height', 15), 'Altura da sapata', 1, item['height'] - 10)
          item['setback_back'] = number(value.fetch('setback_back', 0), 'Recuo traseiro', 0, 500)
          item['setback_left'] = number(value.fetch('setback_left', 0), 'Recuo esquerdo', 0, 500)
          item['setback_right'] = number(value.fetch('setback_right', 0), 'Recuo direito', 0, 500)
          item['max_opening'] = number(value.fetch('max_opening', 600), 'Largura máxima entre vãos', 100, 4000)
          item['frame_material'] = material_name(value.fetch('frame_material', p['hidden_material']), p['hidden_material'])
          raise ArgumentError, 'Nome do material muito longo.' if item['frame_material'].length > Parameters::MATERIAL_NAME_LIMIT
          %w[left right back].each do |side|
            flag = "finish_#{side}"
            raise ArgumentError, 'Acabamento do rodapé inválido.' unless [true, false].include?(value.fetch(flag, false))
            item[flag] = value.fetch(flag, false)
          end
          side = baseboard_side_setbacks(p, item).sum + %w[left right].count { |edge| item["finish_#{edge}"] } * item['thickness']
          rear = item['finish_back'] ? item['thickness'] : 0
          raise ArgumentError, 'Recuos laterais deixam o rodapé sem espaço.' if p['width'] - side <= 3 * item['thickness']
          raise ArgumentError, 'Recuos frontal e traseiro deixam o rodapé sem espaço.' if p['depth'] - item['setback'] - item['setback_back'] - rear <= 3 * item['thickness']
        elsif kind == 'crown'
          %w[left right back].each do |side|
            flag = "crown_#{side}"
            raise ArgumentError, 'Lado do rodateto inválido.' unless [true, false].include?(value.fetch(flag, false))
            item[flag] = value.fetch(flag, false)
            item["setback_#{side}"] = number(value.fetch("setback_#{side}", 0), "Recuo #{side} do rodateto", 0, 500)
          end
          t = item['thickness']
          left = item['crown_left'] ? item['setback_left'] : 0
          right = item['crown_right'] ? item['setback_right'] : 0
          raise ArgumentError, 'Recuos laterais deixam o rodateto sem espaço.' if item['crown_left'] && left + t >= p['width'] || item['crown_right'] && right + t >= p['width'] || item['crown_left'] && item['crown_right'] && left + right + 2 * t >= p['width']
          rear = item['crown_back'] ? item['setback_back'] + t : 0
          raise ArgumentError, 'Recuos frontal e traseiro deixam o rodateto sem espaço.' if item['setback'] + t >= p['depth'] - rear
        end
        item
      end
      raise ArgumentError, 'Já existe este acabamento no módulo.' unless result.map { |v| v['kind'] }.uniq.length == result.length
      result
    end

    def self.normalize_accessories(raw)
      raise ArgumentError, 'Lista de acessórios inválida.' unless raw.is_a?(Array) && raw.length <= 128
      families = %w[wirework outlets cable_grommet hardware casters glides feet hangers supports other]
      result = raw.map do |value|
        raise ArgumentError, 'Acessório inválido.' unless value.is_a?(Hash)
        id = value.fetch('id', '').to_s
        family = value.fetch('family', 'other')
        name = value.fetch('name', '').to_s.strip
        raise ArgumentError, 'Identificação do acessório inválida.' unless id.match?(/\A[a-zA-Z0-9_-]{1,40}\z/)
        raise ArgumentError, 'Família de acessório inválida.' unless families.include?(family)
        raise ArgumentError, 'Informe uma descrição do acessório com até 80 caracteres.' if name.empty? || name.length > 80
        quantity = number(value.fetch('quantity', 1), 'Quantidade do acessório', 1, 999)
        raise ArgumentError, 'Quantidade do acessório deve ser inteira.' unless quantity == quantity.to_i
        {'id'=>id, 'family'=>family, 'name'=>name, 'quantity'=>quantity.to_i}
      end
      raise ArgumentError, 'Identificação de acessório repetida.' unless result.map { |v| v['id'] }.uniq.length == result.length
      result
    end

    def self.trim_panels(p)
      p.fetch('trims', []).flat_map do |value|
        kind = value['kind']
        role = "trim:#{kind}"
        name = kind == 'baseboard' ? 'Rodapé' : 'Rodateto'
        pt = thickness(p, role, value['thickness'])
        if kind == 'baseboard' && value['structure_version'] == 1
          h = value['height'] - value['foot_height']
          f = value['setback']; b = value['setback_back']
          left, right = baseboard_side_setbacks(p, value)
          span = p['width'] - left - right
          frame_left = left + (value['finish_left'] ? pt : 0)
          frame_right = p['width'] - right - (value['finish_right'] ? pt : 0)
          frame_span = frame_right - frame_left
          back_y = p['depth'] - b - (value['finish_back'] ? pt : 0)
          inside = frame_span - 2 * pt
          depth = back_y - f
          raise ArgumentError, 'Recuos deixam o rodapé sem espaço.' if frame_span <= 3 * pt || depth <= 3 * pt
          gaps = (inside / value['max_opening']).ceil
          gaps = [gaps, 1].max
          frame = value['frame_material']
          result = [panel(role, 'Frontal do rodapé', [left, f, -h], [span, pt, h], 1, value['material'])]
          result << panel(role + ':left', 'Acabamento lateral esquerdo do rodapé', [left, f + pt, -h], [pt, depth - pt, h], 0, value['material']) if value['finish_left']
          result << panel(role + ':right', 'Acabamento lateral direito do rodapé', [p['width'] - right - pt, f + pt, -h], [pt, depth - pt, h], 0, value['material']) if value['finish_right']
          result << panel(role + ':back', 'Acabamento traseiro do rodapé', [left, back_y, -h], [span, pt, h], 1, value['material']) if value['finish_back']
          result << panel(role + ':frame:front', 'Rodapé estrutural frontal', [frame_left, f + pt, -h], [frame_span, pt, h], 1, frame)
          result << panel(role + ':frame:back', 'Rodapé estrutural traseiro', [frame_left, back_y - pt, -h], [frame_span, pt, h], 1, frame)
          rail_length = depth - 3 * pt
          upright_height = h
          flat_width = [70.0, inside / 2.0].min
          flat_width = [flat_width, (inside / gaps - pt) / 2.0].min if gaps > 1
          result << panel(role + ':frame:left', 'Rodapé estrutural esquerdo', [frame_left, f + 2 * pt, -h], [pt, rail_length, upright_height], 0, frame)
          result << panel(role + ':frame:right', 'Rodapé estrutural direito', [frame_right - pt, f + 2 * pt, -h], [pt, rail_length, upright_height], 0, frame)
          result << panel(role + ':flat:left', 'Travessa plana esquerda do rodapé', [frame_left + pt, f + 2 * pt, -pt], [flat_width, rail_length, pt], 2, frame)
          result << panel(role + ':flat:right', 'Travessa plana direita do rodapé', [frame_right - pt - flat_width, f + 2 * pt, -pt], [flat_width, rail_length, pt], 2, frame)
          (1...gaps).each do |index|
            x = frame_left + pt + inside * index / gaps - pt / 2.0
            result << panel("#{role}:frame:cross:#{index}", "Travessa do rodapé #{index}", [x, f + 2 * pt, -h], [pt, rail_length, upright_height], 0, frame)
            result << panel("#{role}:flat:cross:#{index}", "Travessa plana do rodapé #{index}", [x + pt, f + 2 * pt, -pt], [flat_width, rail_length, pt], 2, frame)
          end
          next result
        end
        origin = [0, value['setback'], kind == 'baseboard' ? -value['height'] : p['height']]
        result = [panel(role, name, origin, [p['width'], pt, value['height']], 1, value['material'])]
        if kind == 'crown'
          rear_y = p['depth'] - value['setback_back'] - pt
          result << panel(role + ':back', 'Rodateto traseiro', [0, rear_y, p['height']], [p['width'], pt, value['height']], 1, value['material']) if value['crown_back']
          start_y = value['setback'] + pt
          end_y = value['crown_back'] ? rear_y : p['depth']
          result << panel(role + ':left', 'Rodateto esquerdo', [value['setback_left'], start_y, p['height']], [pt, end_y - start_y, value['height']], 0, value['material']) if value['crown_left']
          result << panel(role + ':right', 'Rodateto direito', [p['width'] - value['setback_right'] - pt, start_y, p['height']], [pt, end_y - start_y, value['height']], 0, value['material']) if value['crown_right']
        end
        result
      end
    end

    def self.baseboard_foot_positions(p)
      value = p.fetch('trims', []).find { |trim| trim['kind'] == 'baseboard' && trim['structure_version'] == 1 }
      return [] unless value
      t = thickness(p, 'trim:baseboard', value['thickness'])
      left, right = baseboard_side_setbacks(p, value)
      left += t if value['finish_left']
      right += t if value['finish_right']
      inside = p['width'] - left - right - 2 * t
      gaps = [(inside / value['max_opening']).ceil, 1].max
      xs = [left + t / 2.0, p['width'] - right - t / 2.0]
      (1...gaps).each { |i| xs << left + t + inside * i / gaps }
      ys = [value['setback'] + 1.5 * t, p['depth'] - value['setback_back'] - (value['finish_back'] ? t : 0) - t / 2.0]
      z = p['module_family'] == 'baseboard' ? 0 : -value['height']
      xs.product(ys).map { |x, y| [clean_mm(x), clean_mm(y), z, value['foot_height']] }
    end

    def self.normalize_claddings(raw, p)
      raise ArgumentError, 'Tamponamentos inválidos.' unless raw.is_a?(Array) && raw.length <= 4
      result = raw.map do |value|
        raise ArgumentError, 'Posição do tamponamento inválida.' unless value.is_a?(Hash) && %w[left right top bottom].include?(value['side'])
        material = material_name(value.fetch('material', p['material']), p['material'])
        raise ArgumentError, 'Nome do material inválido.' if material.length > Parameters::MATERIAL_NAME_LIMIT
        item = {'side'=>value['side'], 'material'=>material,
          'thickness'=>number(value.fetch('thickness', p['thickness']), 'Espessura do tamponamento', 6, 40),
          'front'=>number(value.fetch('front', 0), 'Avanço frontal', 0, 300),
          'rear'=>number(value.fetch('rear', 0), 'Avanço traseiro', 0, 300)}
        %w[extend_top extend_bottom].each { |key| item[key] = number(value.fetch(key, 0), "Ajuste das laterais #{key == 'extend_top' ? 'no topo' : 'na base'}", -4000, 4000) }
        if %w[left right].include?(value['side'])
          %w[cover_baseboard cover_crown].each do |key|
            next unless value.key?(key)
            raise ArgumentError, 'Cobertura do rodapé/rodateto inválida.' unless [true, false].include?(value[key])
            item[key] = value[key]
          end
        end
        if value.key?('mode')
          mode = value['mode']
          raise ArgumentError, 'Montagem do tamponamento inválida.' unless %w[panel rail thickened].include?(mode)
          item['mode'] = mode
          item['rail_depth'] = number(value.fetch('rail_depth', 50), 'Profundidade da régua', 10, 1500) unless mode == 'panel'
          if mode == 'thickened'
            layers = number(value.fetch('layers', 1), 'Camadas de engrosso', 1, 6)
            raise ArgumentError, 'Camadas de engrosso devem ser inteiras.' unless layers == layers.to_i
            item['layers'] = layers.to_i
          end
        end
        item
      end
      raise ArgumentError, 'Já existe tamponamento nesta posição.' unless result.map { |v| v['side'] }.uniq.length == result.length
      result
    end

    def self.cladding_panels(p)
      values = p.fetch('claddings', [])
      names = {'left'=>'esquerdo','right'=>'direito','top'=>'superior','bottom'=>'inferior'}
      return configured_cladding_panels(p, values, names) if p.key?('cladding_overlap') || values.any? { |v| v['extend_top'].to_f != 0 || v['extend_bottom'].to_f != 0 }
      if values.all? { |v| !v.key?('mode') }
        widths = values.to_h { |v| [v['side'], thickness(p, "cladding:#{v['side']}", v['thickness'])] }
        return values.map do |v|
          side = v['side']; t = widths[side]; d = p['depth'] + v['front'] + v['rear']
          if %w[left right].include?(side)
            origin = [side == 'left' ? -t : p['width'], -v['front'], 0]
            size = [t, d, p['height']]; axis = 0
          else
            origin = [-widths.fetch('left', 0), -v['front'], side == 'bottom' ? -t : p['height']]
            size = [p['width'] + widths.fetch('left', 0) + widths.fetch('right', 0), d, t]; axis = 2
          end
          panel("cladding:#{side}", "Tamponamento #{names[side]}", origin, size, axis, v['material'])
        end
      end
      bounds = {'left'=>0, 'right'=>p['width'], 'bottom'=>0, 'top'=>p['height']}
      pieces = []
      values.each do |v|
        side = v['side']; mode = v.fetch('mode', 'panel'); base = "cladding:#{side}"
        primary = mode == 'rail' ? "#{base}:front:1" : base
        t = thickness(p, primary, v['thickness'])
        depth = p['depth'] + v['front'] + v['rear']
        front_y = -v['front']; rear_y = p['depth'] + v['rear']
        rail_depth = v.fetch('rail_depth', 50)
        layers = mode == 'thickened' ? v['layers'] : 0
        if mode != 'panel' && (rail_depth > depth || (mode == 'thickened' && 2 * rail_depth > depth))
          raise ArgumentError, 'Profundidade das réguas maior que o espaço disponível.'
        end
        add = lambda do |role, name, offset, y, part_depth, material = v['material']|
          if side == 'left'
            origin = [bounds['left'] - (offset + 1) * t, y, bounds['bottom']]
            size = [t, part_depth, bounds['top'] - bounds['bottom']]; axis = 0
          elsif side == 'right'
            origin = [bounds['right'] + offset * t, y, bounds['bottom']]
            size = [t, part_depth, bounds['top'] - bounds['bottom']]; axis = 0
          elsif side == 'top'
            origin = [bounds['left'], y, bounds['top'] + offset * t]
            size = [bounds['right'] - bounds['left'], part_depth, t]; axis = 2
          else
            origin = [bounds['left'], y, bounds['bottom'] - (offset + 1) * t]
            size = [bounds['right'] - bounds['left'], part_depth, t]; axis = 2
          end
          pieces << panel(role, name, origin, size, axis, material)
        end
        add.call("#{base}:front:1", "Régua frontal do tamponamento #{names[side]}", 0, front_y, rail_depth) if mode == 'rail'
        if mode == 'thickened'
          layers.times do |i|
            add.call("#{base}:front:#{i+1}", "Régua frontal #{i+1} do tamponamento #{names[side]}", i, front_y, rail_depth)
            add.call("#{base}:rear:#{i+1}", "Régua traseira #{i+1} do tamponamento #{names[side]}", i, rear_y - rail_depth, rail_depth, p['hidden_material'])
          end
        end
        add.call(base, "Tamponamento #{names[side]}", layers, front_y, depth) unless mode == 'rail'
        total = (layers + 1) * t
        if side == 'left'
          bounds['left'] -= total
        elsif side == 'right'
          bounds['right'] += total
        elsif side == 'top'
          bounds['top'] += total
        else
          bounds['bottom'] -= total
        end
      end
      pieces
    end

    def self.configured_cladding_panels(p, values, names)
      overlap = p.fetch('cladding_overlap', {'top'=>'horizontal', 'bottom'=>'horizontal'})
      by_side = values.to_h { |v| [v['side'], v] }
      widths = values.to_h do |v|
        role = "cladding:#{v['side']}"
        role += ':front:1' if v['mode'] == 'rail'
        layers = v['mode'] == 'thickened' ? v['layers'] : 0
        [v['side'], (layers + 1) * thickness(p, role, v['thickness'])]
      end
      trim_items = p.fetch('trims', []).to_h { |v| [v['kind'], v] }
      trims = trim_items.transform_values { |v| v['kind'] == 'baseboard' && v['structure_version'] == 1 ? v['height'] - v['foot_height'] : v['height'] }
      p.fetch('reference_trims', {}).each { |key,height| trims[key] = [trims.fetch(key, 0), height].max }
      covers = lambda do |side, kind|
        trim = trim_items[kind]
        if trim && trim.key?('cover_cladding')
          trim['cover_cladding']
        else
          by_side.fetch(side, {}).fetch(kind == 'baseboard' ? 'cover_baseboard' : 'cover_crown', true)
        end
      end
      top_cover = %w[left right].any? { |side| by_side[side] && covers.call(side, 'crown') }
      bottom_cover = %w[left right].any? { |side| by_side[side] && covers.call(side, 'baseboard') }
      top_start = p['height'] + (top_cover ? trims.fetch('crown', 0) : 0)
      bottom_start = bottom_cover ? -trims.fetch('baseboard', 0) : 0
      top_spec = by_side['top']
      top_layers = top_spec && top_spec['mode'] == 'thickened' ? top_spec['layers'] : 0
      top_rail_thickness = top_spec && thickness(p, 'cladding:top:front:1', top_spec['thickness'])
      top_panel_start = top_start + top_layers.to_i * top_rail_thickness.to_f
      side_panel_thickness = %w[left right].to_h do |position|
        spec = by_side[position]
        [position, spec && spec['mode'] != 'rail' ? thickness(p, "cladding:#{position}", spec['thickness']) : 0]
      end
      pieces = []
      values.each do |v|
        side = v['side']; mode = v.fetch('mode', 'panel'); base = "cladding:#{side}"
        t = thickness(p, mode == 'rail' ? "#{base}:front:1" : base, v['thickness'])
        depth = p['depth'] + v['front'] + v['rear']
        rail_depth = v.fetch('rail_depth', 50)
        layers = mode == 'thickened' ? v['layers'] : 0
        if mode != 'panel' && (rail_depth > depth || (mode == 'thickened' && 2 * rail_depth > depth))
          raise ArgumentError, 'Profundidade das réguas maior que o espaço disponível.'
        end
        if %w[left right].include?(side)
          cover_baseboard = covers.call(side, 'baseboard')
          cover_crown = covers.call(side, 'crown')
          lower = (cover_baseboard ? bottom_start : 0) - (overlap['bottom'] == 'sides' ? widths.fetch('bottom', 0) : 0)
          upper = (cover_crown ? top_start : p['height']) + (overlap['top'] == 'sides' ? widths.fetch('top', 0) : 0)
          lower = [lower, -trims.fetch('baseboard', 0)].min if cover_baseboard && trims.key?('baseboard')
          upper = [upper, p['height'] + trims.fetch('crown', 0)].max if cover_crown && trims.key?('crown')
          lower -= v.fetch('extend_bottom', 0)
          upper += v.fetch('extend_top', 0)
        end
        add = lambda do |role, name, offset, y, part_depth, material = v['material']|
          if side == 'left'
            panel_top = role == base && top_spec && overlap['top'] == 'horizontal' ? top_panel_start + v.fetch('extend_top', 0) : upper
            origin = [-(offset + 1) * t, y, lower]; size = [t, part_depth, panel_top - lower]; axis = 0
          elsif side == 'right'
            panel_top = role == base && top_spec && overlap['top'] == 'horizontal' ? top_panel_start + v.fetch('extend_top', 0) : upper
            origin = [p['width'] + offset * t, y, lower]; size = [t, part_depth, panel_top - lower]; axis = 0
          elsif side == 'top'
            x = overlap['top'] == 'horizontal' ? -widths.fetch('left', 0) : 0
            w = p['width'] + (overlap['top'] == 'horizontal' ? widths.fetch('left', 0) + widths.fetch('right', 0) : 0)
            if role != base && overlap['top'] == 'horizontal'
              left_recess = side_panel_thickness['left']
              right_recess = side_panel_thickness['right']
              x += left_recess
              w -= left_recess + right_recess
            end
            origin = [x, y, top_start + offset * t]; size = [w, part_depth, t]; axis = 2
          else
            x = overlap['bottom'] == 'horizontal' ? -widths.fetch('left', 0) : 0
            w = p['width'] + (overlap['bottom'] == 'horizontal' ? widths.fetch('left', 0) + widths.fetch('right', 0) : 0)
            origin = [x, y, bottom_start - (offset + 1) * t]; size = [w, part_depth, t]; axis = 2
          end
          raise ArgumentError, "Ajuste das laterais #{v.fetch('extend_bottom', 0) < 0 ? 'na base' : 'no topo'}: a combinação deixa a peça sem medida física suficiente." if size.any? { |n| n <= 0 }
          pieces << panel(role, name, origin, size, axis, material)
        end
        add.call("#{base}:front:1", "Régua frontal do tamponamento #{names[side]}", 0, -v['front'], rail_depth) if mode == 'rail'
        if mode == 'thickened'
          layers.times do |i|
            add.call("#{base}:front:#{i+1}", "Régua frontal #{i+1} do tamponamento #{names[side]}", i, -v['front'], rail_depth)
            add.call("#{base}:rear:#{i+1}", "Régua traseira #{i+1} do tamponamento #{names[side]}", i, p['depth'] + v['rear'] - rail_depth, rail_depth, p['hidden_material'])
          end
        end
        add.call(base, "Tamponamento #{names[side]}", layers, -v['front'], depth) unless mode == 'rail'
      end
      pieces
    end

    # Recipe roles identify the four enclosing boundaries; actual offsets and sizes
    # determine the common planes. Front/back rails are the two ends of one top boundary.
    def self.window_bounds(region, pieces, nominal = pieces)
      x, z, w, h = region.values_at('x', 'z', 'width', 'height')
      groups = 4.times.map do |edge|
        nominal.select do |piece|
          next false if piece['role'] == 'back' || piece['role'].start_with?('back:', 'front:', 'cladding:')
          o, s = piece.values_at('origin', 'size')
          vertical = edge < 2
          axis = vertical ? 0 : 2
          target = [x, x+w, z, z+h][edge]
          inner = o[axis] + ([0,2].include?(edge) ? s[axis] : 0)
          span = vertical ? [o[2], o[2]+s[2], z, z+h] : [o[0], o[0]+s[0], x, x+w]
          piece['thickness_axis'] == axis && (inner-target).abs < 0.01 && span[0] <= span[2]+0.01 && span[1] >= span[3]-0.01
        end.map { |v| pieces.find { |piece| piece['role'] == v['role'] } }.compact
      end
      return nil if groups.any?(&:empty?)
      limits = groups.each_with_index.map do |group, edge|
        axis = edge < 2 ? 0 : 2
        values = group.map { |b| b['origin'][axis] + ([0,2].include?(edge) ? b['size'][axis] : 0) }
        [0,2].include?(edge) ? values.max : values.min
      end
      groups = groups.each_with_index.map do |group, edge|
        axis = edge < 2 ? 2 : 0
        lo, hi = edge < 2 ? limits[2..3] : limits[0..1]
        group.select { |b| b['origin'][axis] <= lo+0.01 && b['origin'][axis]+b['size'][axis] >= hi-0.01 }
      end
      return nil if groups.any?(&:empty?)
      # Left/right walls delimit depth. Top/bottom boards delimit height;
      # a narrow top rail or shallow shelf cannot shorten the whole bay.
      front = groups.first(2).map { |g| g.map { |b| b['origin'][1] }.min }.max
      rear = groups.first(2).map { |g| g.map { |b| b['origin'][1]+b.fetch('opening_depth', b['size'][1]) }.max }.min
      backs = pieces.select do |piece|
        (piece['role'] == 'back' || piece['role'].start_with?('back:')) && rectangles_overlap?(region, {'x'=>piece['origin'][0], 'z'=>piece['origin'][2],
          'width'=>piece['size'][0], 'height'=>piece['size'][2]})
      end
      rear = [rear, *backs.map { |piece| piece['origin'][1] }].min
      return nil if limits[1] <= limits[0] || limits[3] <= limits[2] || rear <= front
      {'x'=>limits[0], 'z'=>limits[2], 'width'=>limits[1]-limits[0], 'height'=>limits[3]-limits[2], 'front'=>front, 'rear'=>rear, 'depth'=>rear-front}
    end

    # Adjacent closed bays can support one front even when an outer boundary is
    # made of separate aligned dividers. Each bay must still have real closure.
    def self.front_window(region, ids, nodes, pieces, nominal)
      single = window_bounds(region, pieces, nominal)
      return single if single || ids.length < 2
      windows = ids.map { |id| nodes[id] && window_bounds(nodes[id], pieces, nominal) }
      return nil if windows.any?(&:nil?)
      boundaries = 4.times.map do |edge|
        axis, span = edge < 2 ? %w[x width] : %w[z height]
        far = [1,3].include?(edge)
        target = region[axis] + (far ? region[span] : 0)
        candidates = windows.zip(ids).select do |_, id|
          node = nodes.fetch(id)
          (node[axis] + (far ? node[span] : 0) - target).abs < 0.01
        end.map { |window, _| window[axis] + (far ? window[span] : 0) }
        return nil if candidates.empty?
        far ? candidates.min : candidates.max
      end
      front = windows.map { |window| window['front'] }.max
      rear = windows.map { |window| window['rear'] }.min
      return nil if boundaries[1] <= boundaries[0] || boundaries[3] <= boundaries[2] || rear <= front
      {'x'=>boundaries[0], 'z'=>boundaries[2], 'width'=>boundaries[1]-boundaries[0], 'height'=>boundaries[3]-boundaries[2],
       'front'=>front, 'rear'=>rear, 'depth'=>rear-front}
    end

    # The recipe retains removed splits to preserve board identities and positions.
    # Free space must instead use only enclosing boards that still exist. Merge
    # rectangular neighbors across removed separators, including their thickness.
    def self.merged_openings(openings, pieces, nominal, excluded)
      return openings if excluded.none? { |role| role.start_with?('split:') }
      remaining = pieces.reject { |piece| excluded.include?(piece['role']) }
      base = nominal.reject { |piece| excluded.include?(piece['role']) }
      removed = nominal.select { |piece| piece['role'].start_with?('split:') && excluded.include?(piece['role']) }
      result = openings.map(&:dup)
      loop do
        joined = false
        result.each_with_index do |a, i|
          result.each_with_index do |b, j|
            next if j <= i
            axis = if (a['z'] - b['z']).abs < 0.01 && (a['height'] - b['height']).abs < 0.01
              0
            elsif (a['x'] - b['x']).abs < 0.01 && (a['width'] - b['width']).abs < 0.01
              2
            end
            next unless axis
            key, size = axis == 0 ? %w[x width] : %w[z height]
            first, second = [a, b].sort_by { |r| r[key] }
            gap_start = first[key] + first[size]
            gap_end = second[key]
            next unless removed.any? do |piece|
              cross = axis == 0 ? 2 : 0
              cross_key, cross_size = axis == 0 ? %w[z height] : %w[x width]
              piece['thickness_axis'] == axis && (piece['origin'][axis] - gap_start).abs < 0.01 &&
                (piece['origin'][axis] + piece['size'][axis] - gap_end).abs < 0.01 &&
                piece['origin'][cross] <= first[cross_key] + 0.01 &&
                piece['origin'][cross] + piece['size'][cross] >= first[cross_key] + first[cross_size] - 0.01
            end
            region = first.merge(size => second[key] + second[size] - first[key])
            window = window_bounds(region, remaining, base)
            # A partly removed partition can leave an L-shaped area. Never turn
            # remaining shelves/dividers inside it into an empty rectangular bay.
            next if remaining.any? do |piece|
              next false unless [0, 2].include?(piece['thickness_axis']) && !piece['role'].start_with?('front:', 'cladding:')
              rectangles_overlap?(window || region, {'x'=>piece['origin'][0], 'z'=>piece['origin'][2],
                'width'=>piece['size'][0], 'height'=>piece['size'][2]})
            end
            region['id'] = (a['id'].split('|') + b['id'].split('|')).sort.join('|')
            far_edge = axis == 0 ? 1 : 3
            region['edges'] = first['edges'].dup
            region['edges'][far_edge] = second['edges'][far_edge]
            result[i] = region
            result.delete_at(j)
            joined = true
            break
          end
          break if joined
        end
        break unless joined
      end
      result
    end

    def self.windows(raw)
      p = normalize(raw, validate_stock: false)
      return [] if p['assembly'] || p['module_family'] != 'cabinet'
      bare = p.merge('fronts'=>[], 'claddings'=>[], 'trims'=>[])
      actual = layout(bare)
      regions = actual['openings']
      regions.filter_map do |region|
        value = window_bounds(region, actual['panels'], actual['nominal_panels'])
        value && value.merge('id'=>region['id'])
      end
    end

    # A view of a saved recipe preserves legacy geometry; writers normalize first.
    def self.panels(raw); layout(normalize(raw, validate_stock: false, saved: true))['panels']; end
    def self.panel(role, name, origin, size, axis, material = nil)
      { 'role' => role, 'name' => name, 'origin' => origin, 'size' => size, 'thickness_axis' => axis, 'material' => material }
    end
  end
end
